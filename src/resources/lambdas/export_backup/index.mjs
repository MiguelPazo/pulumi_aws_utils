/**
 * Unified Lambda for CloudWatch Logs Export to S3
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import {
    CloudWatchLogsClient,
    CreateExportTaskCommand,
    DescribeExportTasksCommand,
    DescribeLogGroupsCommand
} from "@aws-sdk/client-cloudwatch-logs";
import {PublishCommand, SNSClient} from "@aws-sdk/client-sns";
import {ListObjectsV2Command, PutObjectCommand, S3Client} from "@aws-sdk/client-s3";
import {CreateJobCommand, DescribeJobCommand, S3ControlClient} from "@aws-sdk/client-s3-control";

const logsClient = new CloudWatchLogsClient({region: process.env.AWS_REGION});
const snsClient = new SNSClient({region: process.env.AWS_REGION});
const s3Client = new S3Client({region: process.env.AWS_REGION});
const s3ControlClient = new S3ControlClient({region: process.env.AWS_REGION});

export const handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));

    const {action} = event;

    if (!action) {
        throw new Error('Missing required parameter: action');
    }

    switch (action) {
        case 'list':
            return await listLogGroups(event);
        case 'create':
            return await createExportTask(event);
        case 'check':
            return await checkExportTask(event);
        case 'notify':
            return await sendNotification(event);
        case 'create-batch-job':
            return await createBatchJob(event);
        case 'check-batch-job':
            return await checkBatchJob(event);
        default:
            throw new Error(`Unknown action: ${action}`);
    }
};

/**
 * List all CloudWatch Log Groups
 */
async function listLogGroups(event) {
    const logGroups = [];
    let nextToken = null;

    try {
        do {
            const command = new DescribeLogGroupsCommand({
                nextToken: nextToken
            });

            const response = await logsClient.send(command);

            if (response.logGroups) {
                logGroups.push(...response.logGroups.map(lg => ({
                    logGroupName: lg.logGroupName,
                    storedBytes: lg.storedBytes || 0
                })));
            }

            nextToken = response.nextToken;
        } while (nextToken);

        console.log(`Found ${logGroups.length} log groups`);

        return {
            statusCode: 200,
            logGroups: logGroups,
            totalGroups: logGroups.length
        };
    } catch (error) {
        console.error('Error listing log groups:', error);
        throw error;
    }
}

/**
 * Create CloudWatch Logs export task
 */
async function createExportTask(event) {
    const {logGroupName, bucketName, retentionMonths} = event;

    if (!logGroupName || !bucketName) {
        throw new Error('Missing required parameters: logGroupName and bucketName');
    }

    try {
        // Calculate time range (last N months)
        const now = Date.now();
        const monthsInMs = (retentionMonths || 12) * 30 * 24 * 60 * 60 * 1000;
        const fromTime = now - monthsInMs;

        // Create destination prefix: /cloudwatch/<log-group-name>/
        // Replace all / with -> in log group name
        const sanitizedLogGroupName = logGroupName.replace(/\//g, '--').replace(/^--/, '');
        const destinationPrefix = `cloudwatch/${sanitizedLogGroupName}`;

        console.log(`Creating export task for ${logGroupName}`);
        console.log(`Destination: s3://${bucketName}/${destinationPrefix}`);
        console.log(`Time range: ${new Date(fromTime).toISOString()} to ${new Date(now).toISOString()}`);

        const command = new CreateExportTaskCommand({
            logGroupName: logGroupName,
            from: fromTime,
            to: now,
            destination: bucketName,
            destinationPrefix: destinationPrefix
        });

        const response = await logsClient.send(command);

        console.log(`Export task created: ${response.taskId}`);

        return {
            statusCode: 200,
            taskId: response.taskId,
            logGroupName: logGroupName,
            destinationPrefix: destinationPrefix
        };
    } catch (error) {
        console.error('Error creating export task:', error);

        // If error is "LimitExceededException", it means another task is running
        // Throw the error so Step Functions can retry with exponential backoff
        if (error.name === 'LimitExceededException') {
            console.log('LimitExceededException: Another export task is already running. Will be retried by Step Functions.');
            const retryError = new Error('LimitExceededException: Another export task is already running');
            retryError.name = 'LimitExceededException';
            throw retryError;
        }

        throw error;
    }
}

/**
 * Check CloudWatch Logs export task status
 */
async function checkExportTask(event) {
    const {taskId} = event;

    if (!taskId) {
        throw new Error('Missing required parameter: taskId');
    }

    try {
        const command = new DescribeExportTasksCommand({
            taskId: taskId
        });

        const response = await logsClient.send(command);

        if (!response.exportTasks || response.exportTasks.length === 0) {
            throw new Error(`Export task ${taskId} not found`);
        }

        const task = response.exportTasks[0];
        const status = task.status.code;

        console.log(`Task ${taskId} status: ${status}`);

        return {
            statusCode: 200,
            taskId: taskId,
            status: status,
            isComplete: status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED',
            isFailed: status === 'FAILED' || status === 'CANCELLED',
            logGroupName: event.logGroupName
        };
    } catch (error) {
        console.error('Error checking export task:', error);
        throw error;
    }
}

/**
 * Send SNS notification
 */
async function sendNotification(event) {
    const {message, subject, snsArn} = event;

    if (!snsArn || !message) {
        throw new Error('Missing required parameters: snsArn and message');
    }

    try {
        const command = new PublishCommand({
            TopicArn: snsArn,
            Subject: subject || 'CloudWatch Logs Export Notification',
            Message: typeof message === 'string' ? message : JSON.stringify(message, null, 2)
        });

        const response = await snsClient.send(command);

        console.log(`SNS notification sent: ${response.MessageId}`);

        return {
            statusCode: 200,
            messageId: response.MessageId
        };
    } catch (error) {
        console.error('Error sending SNS notification:', error);
        throw error;
    }
}

/**
 * Create S3 Batch Job to copy bucket data
 */
async function createBatchJob(event) {
    const {sourceBucket, destinationBucket, accountId, roleArn} = event;

    if (!sourceBucket || !destinationBucket || !accountId || !roleArn) {
        throw new Error('Missing required parameters: sourceBucket, destinationBucket, accountId, roleArn');
    }

    try {
        console.log(`Creating batch job to copy from ${sourceBucket} to ${destinationBucket}`);

        // Step 1: List all objects in source bucket
        const objects = [];
        let continuationToken = null;

        do {
            const listCommand = new ListObjectsV2Command({
                Bucket: sourceBucket,
                ContinuationToken: continuationToken
            });

            const listResponse = await s3Client.send(listCommand);

            if (listResponse.Contents) {
                objects.push(...listResponse.Contents.map(obj => obj.Key));
            }

            continuationToken = listResponse.NextContinuationToken;
        } while (continuationToken);

        console.log(`Found ${objects.length} objects in ${sourceBucket}`);

        if (objects.length === 0) {
            return {
                statusCode: 200,
                message: `No objects found in bucket ${sourceBucket}`,
                skipped: true
            };
        }

        // Step 2: Create manifest in CSV format
        // Format: bucket,key
        const manifestContent = objects.map(key => `${sourceBucket},${key}`).join('\n');
        const manifestKey = `manifests/batch-copy-${sourceBucket}-${Date.now()}.csv`;

        const putCommand = new PutObjectCommand({
            Bucket: destinationBucket,
            Key: manifestKey,
            Body: manifestContent,
            ContentType: 'text/csv'
        });

        await s3Client.send(putCommand);
        console.log(`Manifest uploaded to s3://${destinationBucket}/${manifestKey}`);

        // Step 3: Create S3 Batch Job
        const jobCommand = new CreateJobCommand({
            AccountId: accountId,
            ConfirmationRequired: false,
            Operation: {
                S3PutObjectCopy: {
                    TargetResource: `arn:aws:s3:::${destinationBucket}`,
                    MetadataDirective: 'COPY',
                    TargetKeyPrefix: `buckets/${sourceBucket}/`,
                    StorageClass: 'STANDARD'
                }
            },
            Report: {
                Bucket: `arn:aws:s3:::${destinationBucket}`,
                Format: 'Report_CSV_20180820',
                Enabled: true,
                Prefix: `batch-reports/copy-${sourceBucket}`,
                ReportScope: 'AllTasks'
            },
            Manifest: {
                Spec: {
                    Format: 'S3BatchOperations_CSV_20180820',
                    Fields: ['Bucket', 'Key']
                },
                Location: {
                    ObjectArn: `arn:aws:s3:::${destinationBucket}/${manifestKey}`,
                    ETag: 'NOT_REQUIRED'
                }
            },
            Priority: 10,
            RoleArn: roleArn,
            Description: `Copy all objects from ${sourceBucket} to ${destinationBucket}/buckets/${sourceBucket}/`
        });

        const jobResponse = await s3ControlClient.send(jobCommand);

        console.log(`Batch job created: ${jobResponse.JobId}`);

        return {
            statusCode: 200,
            jobId: jobResponse.JobId,
            sourceBucket: sourceBucket,
            objectCount: objects.length,
            manifestKey: manifestKey
        };
    } catch (error) {
        console.error('Error creating batch job:', error);
        throw error;
    }
}

/**
 * Check S3 Batch Job status
 */
async function checkBatchJob(event) {
    const {jobId, accountId} = event;

    if (!jobId || !accountId) {
        throw new Error('Missing required parameters: jobId and accountId');
    }

    try {
        const command = new DescribeJobCommand({
            AccountId: accountId,
            JobId: jobId
        });

        const response = await s3ControlClient.send(command);

        if (!response.Job) {
            throw new Error(`Batch job ${jobId} not found`);
        }

        const status = response.Job.Status;
        console.log(`Batch job ${jobId} status: ${status}`);

        return {
            statusCode: 200,
            jobId: jobId,
            status: status,
            isComplete: status === 'Complete' || status === 'Failed' || status === 'Cancelled',
            isFailed: status === 'Failed' || status === 'Cancelled',
            progressSummary: response.Job.ProgressSummary,
            sourceBucket: event.sourceBucket
        };
    } catch (error) {
        console.error('Error checking batch job:', error);
        throw error;
    }
}
