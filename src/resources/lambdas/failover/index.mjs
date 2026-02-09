/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 * Lambda Function for Multi-Region Failover Operations
 */

import {DescribeDBClustersCommand, DescribeGlobalClustersCommand, FailoverGlobalClusterCommand, RDSClient} from "@aws-sdk/client-rds";
import {
    DeleteReplicationConfigurationCommand,
    DescribeFileSystemsCommand,
    DescribeReplicationConfigurationsCommand,
    EFSClient
} from "@aws-sdk/client-efs";
import {GetBucketReplicationCommand, S3Client} from "@aws-sdk/client-s3";
import {
    CloudFrontClient,
    GetDistributionCommand,
    GetDistributionConfigCommand,
    UpdateDistributionCommand
} from "@aws-sdk/client-cloudfront";
import {
    ChangeResourceRecordSetsCommand,
    GetChangeCommand,
    ListResourceRecordSetsCommand,
    Route53Client
} from "@aws-sdk/client-route-53";
import {PublishCommand, SNSClient} from "@aws-sdk/client-sns";
import {CloudWatchClient, GetMetricStatisticsCommand} from "@aws-sdk/client-cloudwatch";
import {DescribeServicesCommand, DescribeTaskDefinitionCommand, ECSClient, UpdateServiceCommand} from "@aws-sdk/client-ecs";
import {
    DescribeRuleCommand,
    DisableRuleCommand,
    EnableRuleCommand,
    EventBridgeClient
} from "@aws-sdk/client-eventbridge";
import {GetParameterCommand, PutParameterCommand, SSMClient} from "@aws-sdk/client-ssm";

// Global variables for environment configuration
let ENV_CONFIG = null;

/**
 * Load environment variables from SSM Parameter Store if PARAM_STORE_PATH is defined,
 * otherwise use standard environment variables
 */
async function loadEnvironment() {
    if (ENV_CONFIG) {
        return ENV_CONFIG;
    }

    const paramStorePath = process.env.PARAM_STORE_PATH;

    if (paramStorePath) {
        // Load from SSM Parameter Store
        console.log(`Loading environment from SSM Parameter Store: ${paramStorePath}`);
        const ssmClient = new SSMClient({});

        try {
            const command = new GetParameterCommand({
                Name: paramStorePath,
                WithDecryption: true
            });

            const response = await ssmClient.send(command);
            ENV_CONFIG = JSON.parse(response.Parameter.Value);
            console.log('Environment loaded successfully from SSM Parameter Store');
        } catch (error) {
            console.error('Error loading from SSM Parameter Store:', error);
            throw new Error(`Failed to load environment from SSM: ${error.message}`);
        }
    } else {
        // Use standard environment variables
        ENV_CONFIG = {
            REGION: process.env.REGION || process.env.AWS_REGION
        };
    }

    return ENV_CONFIG;
}

// Initialize AWS clients (will use default region from Lambda environment)
const primaryRdsClient = new RDSClient({});
const primaryEfsClient = new EFSClient({});
const s3Client = new S3Client({});
const cloudFrontClient = new CloudFrontClient({});
const route53Client = new Route53Client({});
const snsClient = new SNSClient({});
const cloudWatchClient = new CloudWatchClient({});
const ecsClient = new ECSClient({});
const eventBridgeClient = new EventBridgeClient({});

export const handler = async (event) => {
    // Load environment configuration on first invocation
    await loadEnvironment();

    const {action} = event;

    try {
        switch (action) {
            case 'promote-rds-cluster':
                return await promoteRdsCluster(event);
            case 'check-rds-promotion':
                return await checkRdsPromotion(event);
            case 'disable-efs-replication':
                return await disableEfsReplication(event);
            case 'check-efs-status':
                return await checkEfsStatus(event);
            case 'check-s3-replication':
                return await checkS3Replication(event);
            case 'manage-ecs-service':
                return await manageEcsService(event);
            case 'check-ecs-deployment':
                return await checkEcsDeployment(event);
            case 'disable-eventbridge-rule':
                return await disableEventBridgeRule(event);
            case 'enable-eventbridge-rule':
                return await enableEventBridgeRule(event);
            case 'remove-cloudfront-alias':
                return await removeCloudFrontAlias(event);
            case 'disable-cloudfront':
                return await disableCloudFront(event);
            case 'add-cloudfront-alias':
                return await addCloudFrontAlias(event);
            case 'enable-cloudfront':
                return await enableCloudFront(event);
            case 'check-cloudfront-deployment':
                return await checkCloudFrontDeployment(event);
            case 'get-cloudfront-dns':
                return await getCloudFrontDns(event);
            case 'unlink-route53-alias':
                return await unlinkRoute53Alias(event);
            case 'link-route53-alias':
                return await linkRoute53Alias(event);
            case 'update-route53':
                return await updateRoute53Record(event);
            case 'check-route53':
                return await checkRoute53Change(event);
            case 'notify':
                return await sendNotification(event);
            case 'update-failover-status':
                return await updateFailoverStatus(event);
            case 'get-failover-status':
                return await getFailoverStatus(event);
            default:
                throw new Error(`Unknown action: ${action}`);
        }
    } catch (error) {
        console.error('Error:', error);
        throw error;
    }
};

/**
 * Promote RDS Aurora Global Cluster secondary to primary
 * Checks if the cluster is already the primary writer before attempting promotion
 */
async function promoteRdsCluster(event) {
    const {globalClusterId, secondaryClusterArn, secondaryRegion} = event;

    console.log(`Promoting secondary cluster ${secondaryClusterArn} in region ${secondaryRegion}`);

    const secondaryRdsClient = new RDSClient({region: secondaryRegion});

    // Extract cluster identifier from ARN for status check
    // ARN format: arn:aws:rds:region:account-id:cluster:cluster-name
    const clusterIdMatch = secondaryClusterArn.match(/:cluster:(.+)$/);
    if (!clusterIdMatch) {
        throw new Error(`Invalid cluster ARN format: ${secondaryClusterArn}`);
    }
    const clusterId = clusterIdMatch[1];

    // First, check if the cluster is already the primary writer by checking the Global Cluster
    const describeGlobalCommand = new DescribeGlobalClustersCommand({
        GlobalClusterIdentifier: globalClusterId
    });

    let globalClusterResponse;
    try {
        globalClusterResponse = await secondaryRdsClient.send(describeGlobalCommand);
    } catch (error) {
        console.error(`Error describing global cluster: ${error.message}`);
        throw new Error(`Failed to describe global cluster ${globalClusterId}: ${error.message}`);
    }

    const globalCluster = globalClusterResponse.GlobalClusters[0];
    if (!globalCluster) {
        throw new Error(`Global cluster ${globalClusterId} not found`);
    }

    // Find the primary cluster in the global cluster
    const primaryMember = globalCluster.GlobalClusterMembers?.find(member => member.IsWriter === true);
    const isPrimary = primaryMember && primaryMember.DBClusterArn === secondaryClusterArn;

    if (isPrimary) {
        console.log(`Cluster ${secondaryClusterArn} is already the primary writer in global cluster ${globalClusterId}. No promotion needed.`);
        console.log(`Current primary member: ${primaryMember.DBClusterArn}`);
        return {
            statusCode: 200,
            globalClusterId,
            secondaryClusterArn,
            status: 'already-primary'
        };
    }

    // Log current state
    console.log(`Current primary writer: ${primaryMember?.DBClusterArn || 'Unknown'}`);
    console.log(`Target cluster to promote: ${secondaryClusterArn}`);
    console.log(`Global cluster members: ${globalCluster.GlobalClusterMembers?.length || 0}`);

    // Verify the cluster exists and is available before attempting promotion
    const describeCommand = new DescribeDBClustersCommand({
        DBClusterIdentifier: clusterId
    });

    const describeResponse = await secondaryRdsClient.send(describeCommand);
    const cluster = describeResponse.DBClusters[0];

    if (cluster.Status !== 'available') {
        throw new Error(`Cluster ${secondaryClusterArn} is not available for promotion. Current status: ${cluster.Status}`);
    }

    console.log(`Cluster ${secondaryClusterArn} is available and ready for promotion`);


    // Initiate failover to promote secondary
    // NOTE: FailoverGlobalClusterCommand requires the full ARN of the target cluster
    const command = new FailoverGlobalClusterCommand({
        GlobalClusterIdentifier: globalClusterId,
        TargetDbClusterIdentifier: secondaryClusterArn
    });

    console.log(`Initiating global cluster failover:`);
    console.log(`  Global Cluster: ${globalClusterId}`);
    console.log(`  Target Cluster ARN: ${secondaryClusterArn}`);
    console.log(`  Secondary Region: ${secondaryRegion}`);

    try {
        await secondaryRdsClient.send(command);
        console.log(`Failover command sent successfully`);
    } catch (error) {
        console.error(`Failed to initiate RDS failover: ${error.message}`);
        console.error(`Error code: ${error.name}`);
        throw error;
    }

    return {
        statusCode: 200,
        globalClusterId,
        secondaryClusterArn,
        status: 'promotion-initiated'
    };
}

/**
 * Check RDS cluster promotion status
 */
async function checkRdsPromotion(event) {
    const {secondaryClusterArn, secondaryRegion} = event;

    const secondaryRdsClient = new RDSClient({region: secondaryRegion});

    // Extract cluster identifier from ARN
    // ARN format: arn:aws:rds:region:account-id:cluster:cluster-name
    const clusterIdMatch = secondaryClusterArn.match(/:cluster:(.+)$/);
    if (!clusterIdMatch) {
        throw new Error(`Invalid cluster ARN format: ${secondaryClusterArn}`);
    }
    const clusterId = clusterIdMatch[1];

    const command = new DescribeDBClustersCommand({
        DBClusterIdentifier: clusterId
    });

    const response = await secondaryRdsClient.send(command);
    const cluster = response.DBClusters[0];

    const isComplete = cluster.Status === 'available';
    const isFailed = cluster.Status === 'failed';

    return {
        statusCode: 200,
        isComplete,
        isFailed,
        status: cluster.Status,
        clusterArn: secondaryClusterArn
    };
}

/**
 * Disable EFS replication configuration
 * Automatically retrieves destination filesystem information before disabling replication
 * Note: This operation must be performed in the PRIMARY region where the source filesystem exists
 */
async function disableEfsReplication(event) {
    const {sourceFileSystemId, primaryRegion} = event;

    console.log(`Disabling EFS replication for ${sourceFileSystemId} in primary region ${primaryRegion}`);

    // Create EFS client for primary region
    const primaryRegionEfsClient = new EFSClient({region: primaryRegion});

    try {
        // First, get replication configuration to retrieve destination information
        const describeCommand = new DescribeReplicationConfigurationsCommand({
            FileSystemId: sourceFileSystemId
        });

        const describeResponse = await primaryRegionEfsClient.send(describeCommand);

        if (!describeResponse.Replications || describeResponse.Replications.length === 0) {
            console.warn(`No replication configuration found for ${sourceFileSystemId} in region ${primaryRegion}`);
            return {
                statusCode: 200,
                sourceFileSystemId,
                primaryRegion,
                status: 'no-replication-found',
                destinationFileSystemId: null,
                destinationRegion: null
            };
        }

        const replication = describeResponse.Replications[0];
        const destinationFileSystemId = replication.Destinations[0].FileSystemId;
        const destinationRegion = replication.Destinations[0].Region;

        console.log(`Found destination: ${destinationFileSystemId} in region ${destinationRegion}`);

        // Now delete the replication configuration (must be done from primary region)
        const deleteCommand = new DeleteReplicationConfigurationCommand({
            SourceFileSystemId: sourceFileSystemId
        });

        await primaryRegionEfsClient.send(deleteCommand);

        return {
            statusCode: 200,
            sourceFileSystemId,
            primaryRegion,
            destinationFileSystemId,
            destinationRegion,
            status: 'replication-disabled'
        };
    } catch (error) {
        // If replication not found, it means it was already deleted previously - this is a success case
        if (error.name === 'ReplicationNotFound' ||
            error.ErrorCode === 'ReplicationNotFound' ||
            error.message?.includes('No replications found')) {
            console.log(`Replication not found for ${sourceFileSystemId}. Already deleted in previous execution.`);
            return {
                statusCode: 200,
                sourceFileSystemId,
                primaryRegion,
                status: 'already-deleted',
                destinationFileSystemId: null,
                destinationRegion: null
            };
        }

        // Some other error occurred
        console.error(`Error disabling EFS replication: ${error.message}`);
        throw error;
    }
}

/**
 * Check EFS replication deletion status
 * Verifies that the replication configuration has been completely deleted from the source filesystem
 */
async function checkEfsStatus(event) {
    const {sourceFileSystemId, primaryRegion} = event;

    console.log(`Checking if replication has been deleted for ${sourceFileSystemId} in region ${primaryRegion}`);

    const primaryRegionEfsClient = new EFSClient({region: primaryRegion});

    try {
        const command = new DescribeReplicationConfigurationsCommand({
            FileSystemId: sourceFileSystemId
        });

        const response = await primaryRegionEfsClient.send(command);

        // If we get a response with replications, check if any are still DELETING
        if (response.Replications && response.Replications.length > 0) {
            const replication = response.Replications[0];
            const replicationStatus = replication.Destinations[0].Status;

            console.log(`Replication status: ${replicationStatus}`);

            // Replication still exists and is being deleted
            return {
                statusCode: 200,
                isComplete: false,
                status: replicationStatus,
                sourceFileSystemId
            };
        }

        // No replications found, deletion is complete
        console.log(`No replication configuration found. Deletion complete.`);
        return {
            statusCode: 200,
            isComplete: true,
            status: 'DELETED',
            sourceFileSystemId
        };
    } catch (error) {
        // If we get a validation error or ReplicationNotFound error, that's good - deletion complete
        if (error.name === 'ValidationException' ||
            error.name === 'ReplicationNotFound' ||
            error.ErrorCode === 'ReplicationNotFound' ||
            error.message?.includes('does not have a replication configuration') ||
            error.message?.includes('No replications found')) {
            console.log(`Replication configuration not found (expected). Deletion complete.`);
            return {
                statusCode: 200,
                isComplete: true,
                status: 'DELETED',
                sourceFileSystemId
            };
        }

        // Some other error occurred
        console.error(`Error checking EFS replication status: ${error.message}`);
        throw error;
    }
}

/**
 * Check S3 replication status using CloudWatch metrics
 */
async function checkS3Replication(event) {
    const {bucket, primaryRegion} = event;
    const bucketName = bucket.bucketName;
    const bucketRegion = bucket.region;

    // Use bucketRegion if provided, otherwise fall back to primaryRegion
    const effectiveRegion = bucketRegion ? bucketRegion : primaryRegion;

    console.log(`Checking S3 replication status for ${bucketName} in region: ${effectiveRegion}`);

    // Create a region-specific S3 client
    const regionalS3Client = new S3Client({region: effectiveRegion});

    // Get replication configuration
    const replicationCommand = new GetBucketReplicationCommand({
        Bucket: bucketName
    });

    const replicationConfig = await regionalS3Client.send(replicationCommand);

    // Check replication metrics using CloudWatch in the bucket's region
    const regionalCloudWatchClient = new CloudWatchClient({region: effectiveRegion});

    const now = new Date();
    const oneHourAgo = new Date(now - 3600000);

    const metricsCommand = new GetMetricStatisticsCommand({
        Namespace: 'AWS/S3',
        MetricName: 'ReplicationLatency',
        Dimensions: [
            {
                Name: 'SourceBucket',
                Value: bucketName
            }
        ],
        StartTime: oneHourAgo,
        EndTime: now,
        Period: 3600,
        Statistics: ['Maximum']
    });

    const metricsResponse = await regionalCloudWatchClient.send(metricsCommand);

    const latency = metricsResponse.Datapoints.length > 0
        ? metricsResponse.Datapoints[0].Maximum
        : 0;

    const isSynced = latency < 900; // Less than 15 minutes

    return {
        statusCode: 200,
        bucketName,
        bucketRegion: effectiveRegion,
        isSynced,
        latency,
        replicationEnabled: !!replicationConfig.ReplicationConfiguration
    };
}

/**
 * Manage ECS service - Always updates to latest task definition revision and forces new deployment
 * Gets the latest revision of the task definition family and updates the service
 * Forces new deployment even if already using the latest revision
 */
async function manageEcsService(event) {
    const {service: serviceConfig, secondaryRegion} = event;
    const clusterName = serviceConfig.clusterName;
    const serviceName = serviceConfig.serviceName;
    const ecsRegion = serviceConfig.region;

    // Use ecsRegion if provided, otherwise fall back to secondaryRegion
    const effectiveRegion = ecsRegion ? ecsRegion : secondaryRegion;

    console.log(`Managing ECS service ${serviceName} in cluster ${clusterName} in region: ${effectiveRegion}`);

    // Create region-specific ECS client
    const regionalEcsClient = new ECSClient({region: effectiveRegion});

    // Get current service configuration
    const describeCommand = new DescribeServicesCommand({
        cluster: clusterName,
        services: [serviceName]
    });

    const describeResponse = await regionalEcsClient.send(describeCommand);

    if (!describeResponse.services || describeResponse.services.length === 0) {
        throw new Error(`Service ${serviceName} not found in cluster ${clusterName}`);
    }

    const service = describeResponse.services[0];
    const currentTaskDefinition = service.taskDefinition;
    const currentDesiredCount = service.desiredCount;

    // Extract task definition family name from ARN
    // Format: arn:aws:ecs:region:account:task-definition/family:revision
    const taskDefParts = currentTaskDefinition.split('/');
    const familyWithRevision = taskDefParts[taskDefParts.length - 1];
    const family = familyWithRevision.split(':')[0];

    console.log(`Current task definition: ${currentTaskDefinition}, Family: ${family}`);

    // Get the latest ACTIVE revision of the task definition family
    const describeTaskDefCommand = new DescribeTaskDefinitionCommand({
        taskDefinition: family
    });

    const taskDefResponse = await regionalEcsClient.send(describeTaskDefCommand);
    const targetTaskDefinition = taskDefResponse.taskDefinition.taskDefinitionArn;
    const latestRevision = taskDefResponse.taskDefinition.revision;

    console.log(`Latest task definition revision found: ${latestRevision} (${targetTaskDefinition})`);
    console.log(`Current desired count: ${currentDesiredCount}`);

    // Always update service with latest task definition and force new deployment
    const updateCommand = new UpdateServiceCommand({
        cluster: clusterName,
        service: serviceName,
        taskDefinition: targetTaskDefinition,
        desiredCount: currentDesiredCount,
        forceNewDeployment: true
    });

    const updateResponse = await regionalEcsClient.send(updateCommand);

    return {
        statusCode: 200,
        clusterName,
        serviceName,
        taskDefinition: targetTaskDefinition,
        desiredCount: currentDesiredCount,
        deploymentId: updateResponse.service.deployments[0]?.id,
        status: 'update-initiated',
        ecsRegion: effectiveRegion
    };
}

/**
 * Check ECS deployment status
 */
async function checkEcsDeployment(event) {
    const {clusterName, serviceName, deploymentId, ecsRegion} = event;

    console.log(`Checking ECS deployment ${deploymentId} for service ${serviceName} in cluster ${clusterName} in region: ${ecsRegion}`);

    // Create region-specific ECS client
    const regionalEcsClient = new ECSClient({region: ecsRegion});

    const describeCommand = new DescribeServicesCommand({
        cluster: clusterName,
        services: [serviceName]
    });

    const describeResponse = await regionalEcsClient.send(describeCommand);

    if (!describeResponse.services || describeResponse.services.length === 0) {
        throw new Error(`Service ${serviceName} not found in cluster ${clusterName}`);
    }

    const service = describeResponse.services[0];

    // Find the specific deployment
    const deployment = service.deployments.find(d => d.id === deploymentId);

    if (!deployment) {
        // Deployment might have completed and been removed
        // Check if there's only one deployment with status PRIMARY
        const primaryDeployment = service.deployments.find(d => d.status === 'PRIMARY');
        if (service.deployments.length === 1 && primaryDeployment) {
            return {
                statusCode: 200,
                isComplete: true,
                isFailed: false,
                status: 'PRIMARY',
                clusterName,
                serviceName,
                deploymentId
            };
        }

        return {
            statusCode: 200,
            isComplete: false,
            isFailed: true,
            status: 'NOT_FOUND',
            clusterName,
            serviceName,
            deploymentId
        };
    }

    // Check deployment status
    const isComplete = deployment.status === 'PRIMARY' &&
                      deployment.runningCount === deployment.desiredCount &&
                      service.deployments.length === 1;

    const isFailed = deployment.rolloutState === 'FAILED' ||
                     deployment.status === 'INACTIVE';

    return {
        statusCode: 200,
        isComplete,
        isFailed,
        status: deployment.status,
        rolloutState: deployment.rolloutState,
        runningCount: deployment.runningCount,
        desiredCount: deployment.desiredCount,
        clusterName,
        serviceName,
        deploymentId
    };
}

/**
 * Disable EventBridge Rule
 * Checks if the rule is already disabled before attempting to disable it
 */
async function disableEventBridgeRule(event) {
    const {ruleName, region} = event;

    console.log(`Disabling EventBridge rule ${ruleName} in region ${region}`);

    const regionEventBridgeClient = new EventBridgeClient({region: region});

    // First, check if the rule exists and get its current state
    let ruleInfo;
    try {
        const describeCommand = new DescribeRuleCommand({
            Name: ruleName
        });

        ruleInfo = await regionEventBridgeClient.send(describeCommand);
    } catch (error) {
        if (error.name === 'ResourceNotFoundException') {
            console.warn(`Rule ${ruleName} not found in region ${region}`);
            return {
                statusCode: 200,
                ruleName,
                region: region,
                state: 'not-found',
                status: 'rule-not-found'
            };
        }
        throw error;
    }

    // Check if the rule is already disabled
    if (ruleInfo.State === 'DISABLED') {
        console.log(`Rule ${ruleName} is already disabled in region ${region}`);
        return {
            statusCode: 200,
            ruleName,
            region: region,
            state: 'DISABLED',
            status: 'already-disabled'
        };
    }

    // Disable the rule
    const disableCommand = new DisableRuleCommand({
        Name: ruleName
    });
    await regionEventBridgeClient.send(disableCommand);

    return {
        statusCode: 200,
        ruleName,
        region: region,
        state: 'DISABLED',
        status: 'disabled'
    };
}

/**
 * Enable EventBridge Rule
 * Checks if the rule is already enabled before attempting to enable it
 */
async function enableEventBridgeRule(event) {
    const {ruleName, region} = event;

    console.log(`Enabling EventBridge rule ${ruleName} in region ${region}`);

    const regionEventBridgeClient = new EventBridgeClient({region: region});

    // First, check if the rule exists and get its current state
    let ruleInfo;
    try {
        const describeCommand = new DescribeRuleCommand({
            Name: ruleName
        });

        ruleInfo = await regionEventBridgeClient.send(describeCommand);
    } catch (error) {
        if (error.name === 'ResourceNotFoundException') {
            console.warn(`Rule ${ruleName} not found in region ${region}`);
            return {
                statusCode: 200,
                ruleName,
                region: region,
                state: 'not-found',
                status: 'rule-not-found'
            };
        }
        throw error;
    }

    // Check if the rule is already enabled
    if (ruleInfo.State === 'ENABLED') {
        console.log(`Rule ${ruleName} is already enabled in region ${region}`);
        return {
            statusCode: 200,
            ruleName,
            region: region,
            state: 'ENABLED',
            status: 'already-enabled'
        };
    }

    // Enable the rule
    const enableCommand = new EnableRuleCommand({
        Name: ruleName
    });
    await regionEventBridgeClient.send(enableCommand);

    return {
        statusCode: 200,
        ruleName,
        region: region,
        state: 'ENABLED',
        status: 'enabled'
    };
}

/**
 * Remove aliases from CloudFront distribution
 * Checks if the aliases are already removed before attempting to remove them
 */
async function removeCloudFrontAlias(event) {
    const {distributionId, aliasesToRemove} = event;

    if (!aliasesToRemove || aliasesToRemove.length === 0) {
        return {
            statusCode: 200,
            distributionId,
            aliasesRemoved: [],
            status: 'no-aliases-to-remove'
        };
    }

    console.log(`Removing aliases ${aliasesToRemove.join(', ')} from distribution ${distributionId}`);

    // Get current configuration
    const getCommand = new GetDistributionConfigCommand({
        Id: distributionId
    });

    const {DistributionConfig, ETag} = await cloudFrontClient.send(getCommand);

    // Check which aliases actually exist and need to be removed
    const existingAliases = DistributionConfig.Aliases?.Items || [];
    const aliasesToActuallyRemove = aliasesToRemove.filter(alias => existingAliases.includes(alias));

    if (aliasesToActuallyRemove.length === 0) {
        console.log(`All specified aliases are already removed from distribution ${distributionId}`);
        return {
            statusCode: 200,
            distributionId,
            aliasesRemoved: [],
            status: 'already-removed'
        };
    }

    // Remove the aliases
    if (DistributionConfig.Aliases && DistributionConfig.Aliases.Items) {
        DistributionConfig.Aliases.Items = DistributionConfig.Aliases.Items.filter(
            alias => !aliasesToRemove.includes(alias)
        );
        DistributionConfig.Aliases.Quantity = DistributionConfig.Aliases.Items.length;
    }

    // Update distribution
    const updateCommand = new UpdateDistributionCommand({
        Id: distributionId,
        DistributionConfig,
        IfMatch: ETag
    });

    const updateResponse = await cloudFrontClient.send(updateCommand);

    return {
        statusCode: 200,
        distributionId,
        aliasesRemoved: aliasesToActuallyRemove,
        etag: updateResponse.ETag,
        status: 'aliases-removed'
    };
}

/**
 * Disable CloudFront distribution
 * Checks if the distribution is already disabled before attempting to disable it
 */
async function disableCloudFront(event) {
    const {distributionId} = event;

    console.log(`Disabling CloudFront distribution ${distributionId}`);

    const getCommand = new GetDistributionConfigCommand({
        Id: distributionId
    });

    const {DistributionConfig, ETag} = await cloudFrontClient.send(getCommand);

    // Check if the distribution is already disabled
    if (!DistributionConfig.Enabled) {
        console.log(`CloudFront distribution ${distributionId} is already disabled`);
        return {
            statusCode: 200,
            distributionId,
            status: 'already-disabled'
        };
    }

    // Disable the distribution
    DistributionConfig.Enabled = false;

    const updateCommand = new UpdateDistributionCommand({
        Id: distributionId,
        DistributionConfig,
        IfMatch: ETag
    });

    const updateResponse = await cloudFrontClient.send(updateCommand);

    return {
        statusCode: 200,
        distributionId,
        etag: updateResponse.ETag,
        status: 'disabled'
    };
}

/**
 * Add aliases to CloudFront distribution
 */
async function addCloudFrontAlias(event) {
    const {distributionId, aliasesToAdd} = event;

    if (!aliasesToAdd || aliasesToAdd.length === 0) {
        return {
            statusCode: 200,
            distributionId,
            aliasesAdded: [],
            status: 'no-aliases-to-add'
        };
    }

    console.log(`Adding aliases ${aliasesToAdd.join(', ')} to distribution ${distributionId}`);

    const getCommand = new GetDistributionConfigCommand({
        Id: distributionId
    });

    const {DistributionConfig, ETag} = await cloudFrontClient.send(getCommand);

    // Add the aliases if not already present
    if (!DistributionConfig.Aliases) {
        DistributionConfig.Aliases = {Quantity: 0, Items: []};
    }

    const aliasesAdded = [];
    for (const alias of aliasesToAdd) {
        if (!DistributionConfig.Aliases.Items.includes(alias)) {
            DistributionConfig.Aliases.Items.push(alias);
            aliasesAdded.push(alias);
        }
    }

    if (aliasesAdded.length > 0) {
        DistributionConfig.Aliases.Quantity = DistributionConfig.Aliases.Items.length;

        const updateCommand = new UpdateDistributionCommand({
            Id: distributionId,
            DistributionConfig,
            IfMatch: ETag
        });

        const updateResponse = await cloudFrontClient.send(updateCommand);

        return {
            statusCode: 200,
            distributionId,
            aliasesAdded,
            etag: updateResponse.ETag,
            status: 'aliases-added'
        };
    }

    return {
        statusCode: 200,
        distributionId,
        aliasesAdded: [],
        status: 'no-update-needed'
    };
}

/**
 * Enable CloudFront distribution
 */
async function enableCloudFront(event) {
    const {distributionId} = event;

    console.log(`Checking and enabling CloudFront distribution ${distributionId}`);

    const getCommand = new GetDistributionConfigCommand({
        Id: distributionId
    });

    const {DistributionConfig, ETag} = await cloudFrontClient.send(getCommand);

    if (DistributionConfig.Enabled) {
        return {
            statusCode: 200,
            distributionId,
            status: 'already-enabled'
        };
    }

    // Enable the distribution
    DistributionConfig.Enabled = true;

    const updateCommand = new UpdateDistributionCommand({
        Id: distributionId,
        DistributionConfig,
        IfMatch: ETag
    });

    const updateResponse = await cloudFrontClient.send(updateCommand);

    return {
        statusCode: 200,
        distributionId,
        etag: updateResponse.ETag,
        status: 'enabled'
    };
}

/**
 * Check CloudFront distribution deployment status
 */
async function checkCloudFrontDeployment(event) {
    const {distributionId} = event;

    console.log(`Checking CloudFront deployment status for distribution ${distributionId}`);

    const getCommand = new GetDistributionCommand({
        Id: distributionId
    });

    const response = await cloudFrontClient.send(getCommand);
    const distribution = response.Distribution;

    // Get the distribution status
    const status = distribution.Status;
    const inProgressInvalidationBatches = distribution.InProgressInvalidationBatches || 0;

    console.log(`Distribution status: ${status}, In-progress invalidations: ${inProgressInvalidationBatches}`);

    // Distribution is deployed when status is "Deployed" and no invalidations in progress
    const isComplete = status === 'Deployed' && inProgressInvalidationBatches === 0;

    return {
        statusCode: 200,
        distributionId,
        isComplete,
        status,
        inProgressInvalidationBatches
    };
}

/**
 * Get CloudFront distribution DNS name
 * Retrieves the domain name of a CloudFront distribution
 */
async function getCloudFrontDns(event) {
    const {distributionId} = event;

    console.log(`Getting CloudFront DNS name for distribution ${distributionId}`);

    const getCommand = new GetDistributionCommand({
        Id: distributionId
    });

    const response = await cloudFrontClient.send(getCommand);
    const distribution = response.Distribution;

    return {
        statusCode: 200,
        distributionId,
        dnsName: distribution.DomainName
    };
}

/**
 * Unlink Route53 alias - Delete DNS record from Route53
 * Removes the DNS record for the specified alias name
 */
async function unlinkRoute53Alias(event) {
    const {hostedZoneId, aliasName} = event;

    console.log(`Unlinking Route53 alias ${aliasName} from hosted zone ${hostedZoneId}`);

    // Normalize the record name (Route53 adds a trailing dot)
    const normalizedRecordName = aliasName.endsWith('.') ? aliasName : `${aliasName}.`;

    try {
        // First, get the existing record
        const listCommand = new ListResourceRecordSetsCommand({
            HostedZoneId: hostedZoneId,
            StartRecordName: normalizedRecordName,
            StartRecordType: 'A',
            MaxItems: 1
        });

        const listResponse = await route53Client.send(listCommand);

        // Find the matching record
        const existingRecord = listResponse.ResourceRecordSets?.find(
            record => record.Name === normalizedRecordName && record.Type === 'A'
        );

        if (!existingRecord) {
            console.log(`Record ${aliasName} not found in hosted zone ${hostedZoneId}. Already deleted.`);
            return {
                statusCode: 200,
                aliasName,
                status: 'already-deleted'
            };
        }

        // Delete the record
        const deleteCommand = new ChangeResourceRecordSetsCommand({
            HostedZoneId: hostedZoneId,
            ChangeBatch: {
                Changes: [
                    {
                        Action: 'DELETE',
                        ResourceRecordSet: existingRecord
                    }
                ]
            }
        });

        const response = await route53Client.send(deleteCommand);

        return {
            statusCode: 200,
            changeId: response.ChangeInfo.Id,
            status: response.ChangeInfo.Status,
            aliasName
        };
    } catch (error) {
        if (error.name === 'InvalidChangeBatch' && error.message?.includes('it was not found')) {
            console.log(`Record ${aliasName} not found. Already deleted.`);
            return {
                statusCode: 200,
                aliasName,
                status: 'already-deleted',
                changeId: null
            };
        }
        throw error;
    }
}

/**
 * Link Route53 alias - Create/update DNS record pointing to CloudFront
 * Creates or updates an A record alias pointing to a CloudFront distribution
 */
async function linkRoute53Alias(event) {
    const {hostedZoneId, aliasName, distributionDnsName} = event;

    console.log(`Linking Route53 alias ${aliasName} to CloudFront distribution ${distributionDnsName}`);

    // CloudFront distributions always use the global hosted zone ID
    const cloudFrontHostedZoneId = 'Z2FDTNDATAQYW2';

    // Normalize names (Route53 adds a trailing dot)
    const normalizedAliasName = aliasName.endsWith('.') ? aliasName : `${aliasName}.`;
    const normalizedDistributionDns = distributionDnsName.endsWith('.') ? distributionDnsName : `${distributionDnsName}.`;

    try {
        // Check if record already exists and points to the target
        const listCommand = new ListResourceRecordSetsCommand({
            HostedZoneId: hostedZoneId,
            StartRecordName: normalizedAliasName,
            StartRecordType: 'A',
            MaxItems: 1
        });

        const listResponse = await route53Client.send(listCommand);

        const existingRecord = listResponse.ResourceRecordSets?.find(
            record => record.Name === normalizedAliasName && record.Type === 'A'
        );

        // Check if it already points to the target
        if (existingRecord?.AliasTarget &&
            existingRecord.AliasTarget.DNSName === normalizedDistributionDns &&
            existingRecord.AliasTarget.HostedZoneId === cloudFrontHostedZoneId) {
            console.log(`Route53 alias ${aliasName} already points to ${distributionDnsName}`);
            return {
                statusCode: 200,
                changeId: null,
                status: 'already-configured',
                aliasName
            };
        }
    } catch (error) {
        // If we can't list records, we'll proceed with the upsert
        console.warn(`Could not check existing record: ${error.message}`);
    }

    // Create or update the record
    const upsertCommand = new ChangeResourceRecordSetsCommand({
        HostedZoneId: hostedZoneId,
        ChangeBatch: {
            Changes: [
                {
                    Action: 'UPSERT',
                    ResourceRecordSet: {
                        Name: aliasName,
                        Type: 'A',
                        AliasTarget: {
                            HostedZoneId: cloudFrontHostedZoneId,
                            DNSName: distributionDnsName,
                            EvaluateTargetHealth: false
                        }
                    }
                }
            ]
        }
    });

    const response = await route53Client.send(upsertCommand);

    return {
        statusCode: 200,
        changeId: response.ChangeInfo.Id,
        status: response.ChangeInfo.Status,
        aliasName
    };
}

/**
 * Detect the hosted zone ID based on the target DNS name
 * @param {string} dnsName - The target DNS name (e.g., CloudFront distribution, ALB, NLB)
 * @returns {string} The corresponding hosted zone ID
 */
function detectHostedZoneId(dnsName) {
    // CloudFront distributions
    if (dnsName.includes('.cloudfront.net')) {
        return 'Z2FDTNDATAQYW2'; // Global CloudFront Hosted Zone ID
    }

    // Application Load Balancer and Network Load Balancer by region
    // Extract region from DNS name (format: name.region.elb.amazonaws.com)
    const elbMatch = dnsName.match(/\.([a-z]{2}-[a-z]+-\d)\.elb\.amazonaws\.com/);
    if (elbMatch) {
        const region = elbMatch[1];

        // ALB/NLB Hosted Zone IDs by region
        // Source: https://docs.aws.amazon.com/general/latest/gr/elb.html
        const elbHostedZones = {
            'us-east-1': 'Z35SXDOTRQ7X7K',
            'us-east-2': 'Z3AADJGX6KTTL2',
            'us-west-1': 'Z368ELLRRE2KJ0',
            'us-west-2': 'Z1H1FL5HABSF5',
            'ca-central-1': 'ZQSVJUPU6J1EY',
            'eu-central-1': 'Z215JYRZR1TBD5',
            'eu-west-1': 'Z32O12XQLNTSW2',
            'eu-west-2': 'ZHURV8PSTC4K8',
            'eu-west-3': 'Z3Q77PNBQS71R4',
            'eu-north-1': 'Z23TAZ6LKFMNIO',
            'eu-south-1': 'Z3ULH7SSC9OV64',
            'ap-east-1': 'Z3DQVH9N71FHZ0',
            'ap-northeast-1': 'Z14GRHDCWA56QT',
            'ap-northeast-2': 'ZWKZPGTI48KDX',
            'ap-northeast-3': 'Z5LXEXXYW11ES',
            'ap-southeast-1': 'Z1LMS91P8CMLE5',
            'ap-southeast-2': 'Z1GM3OXH4ZPM65',
            'ap-south-1': 'ZP97RAFLXTNZK',
            'me-south-1': 'ZS929ML54UICD',
            'sa-east-1': 'Z2P70J7HTTTPLU',
            'af-south-1': 'Z268VQBMOI5EKX',
            'ap-southeast-3': 'Z01971771FYVNCOVWJU1G'
        };

        return elbHostedZones[region] || null;
    }

    // S3 website endpoints
    if (dnsName.includes('.s3-website')) {
        const s3Match = dnsName.match(/\.s3-website[.-]([a-z]{2}-[a-z]+-\d)/);
        if (s3Match) {
            const region = s3Match[1];

            // S3 Website Hosted Zone IDs by region
            const s3HostedZones = {
                'us-east-1': 'Z3AQBSTGFYJSTF',
                'us-east-2': 'Z2O1EMRO9K5GLX',
                'us-west-1': 'Z2F56UZL2M1ACD',
                'us-west-2': 'Z3BJ6K6RIION7M',
                'ca-central-1': 'Z1QDHH18159H29',
                'eu-central-1': 'Z21DNDUVLTQW6Q',
                'eu-west-1': 'Z1BKCTXD74EZPE',
                'eu-west-2': 'Z3GKZC51ZF0DB4',
                'eu-west-3': 'Z3R1K369G5AVDG',
                'ap-northeast-1': 'Z2M4EHUR26P7ZW',
                'ap-northeast-2': 'Z3W03O7B5YMIYP',
                'ap-southeast-1': 'Z3O0J2DXBE1FTB',
                'ap-southeast-2': 'Z1WCIGYICN2BYD',
                'ap-south-1': 'Z11RGJOFQNVJUP',
                'sa-east-1': 'Z7KQH4QJS55SO'
            };

            return s3HostedZones[region] || null;
        }
    }

    console.warn(`Could not detect hosted zone ID for DNS name: ${dnsName}`);
    return null;
}

/**
 * Convert wildcard pattern to regex
 * @param {string} pattern - Wildcard pattern (e.g., "*.cloudfront.net")
 * @returns {RegExp} - Compiled regex
 */
function wildcardToRegex(pattern) {
    // Escape special regex characters except *
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    // Replace * with .*
    const regexPattern = escaped.replace(/\*/g, '.*');
    // Add start and end anchors, make trailing dot optional
    return new RegExp(`^${regexPattern}\\.?$`, 'i');
}

/**
 * Update Route53 DNS record
 * Automatically detects the target hosted zone ID if not provided
 * Checks if the record already points to the target before updating
 * Optionally deletes records matching a pattern before creating the new one
 */
async function updateRoute53Record(event) {
    const {hostedZoneId, recordName, newTargetDnsName, newTargetZoneId, deleteRecordsLike} = event;

    console.log(`Updating Route53 record ${recordName} in zone ${hostedZoneId}`);

    // Auto-detect target hosted zone ID if not provided
    let targetZoneId = newTargetZoneId;
    if (!targetZoneId) {
        targetZoneId = detectHostedZoneId(newTargetDnsName);
        if (!targetZoneId) {
            throw new Error(`Could not auto-detect hosted zone ID for target: ${newTargetDnsName}. Please provide newTargetZoneId explicitly.`);
        }
        console.log(`Auto-detected hosted zone ID: ${targetZoneId} for ${newTargetDnsName}`);
    }

    // Normalize the record name (Route53 adds a trailing dot)
    const normalizedRecordName = recordName.endsWith('.') ? recordName : `${recordName}.`;
    const normalizedTargetDnsName = newTargetDnsName.endsWith('.') ? newTargetDnsName : `${newTargetDnsName}.`;

    // List existing records for this name
    let existingRecord = null;
    let recordsToDelete = [];

    try {
        const listCommand = new ListResourceRecordSetsCommand({
            HostedZoneId: hostedZoneId,
            StartRecordName: normalizedRecordName,
            StartRecordType: 'A',
            MaxItems: 10 // Get a few records to handle multiple records with same name
        });

        const listResponse = await route53Client.send(listCommand);

        if (listResponse.ResourceRecordSets && listResponse.ResourceRecordSets.length > 0) {
            // Filter records that match our record name
            const matchingRecords = listResponse.ResourceRecordSets.filter(
                record => record.Name === normalizedRecordName && record.Type === 'A'
            );

            if (matchingRecords.length > 0) {
                existingRecord = matchingRecords[0];

                // Check if it already points to the target
                if (existingRecord.AliasTarget &&
                    existingRecord.AliasTarget.DNSName === normalizedTargetDnsName &&
                    existingRecord.AliasTarget.HostedZoneId === targetZoneId) {
                    console.log(`Route53 record ${recordName} already points to ${newTargetDnsName}`);
                    return {
                        statusCode: 200,
                        changeId: null,
                        status: 'already-configured',
                        recordName,
                        detectedZoneId: !newTargetZoneId ? targetZoneId : undefined
                    };
                }

                // If deleteRecordsLike is provided, find records to delete
                if (deleteRecordsLike) {
                    console.log(`Checking for records matching pattern: ${deleteRecordsLike}`);
                    const regex = wildcardToRegex(deleteRecordsLike);

                    for (const record of matchingRecords) {
                        let targetDnsName = null;

                        if (record.AliasTarget) {
                            targetDnsName = record.AliasTarget.DNSName;
                        } else if (record.ResourceRecords && record.ResourceRecords.length > 0) {
                            targetDnsName = record.ResourceRecords[0].Value;
                        }

                        if (targetDnsName && regex.test(targetDnsName)) {
                            console.log(`Record ${recordName} -> ${targetDnsName} matches pattern, will be deleted`);
                            recordsToDelete.push(record);
                        }
                    }
                }
            }
        }
    } catch (error) {
        // If we can't list records, we'll proceed with the update
        console.warn(`Could not check existing record configuration: ${error.message}`);
    }

    // Build the changes array
    const changes = [];

    // First, delete matching records
    for (const recordToDelete of recordsToDelete) {
        changes.push({
            Action: 'DELETE',
            ResourceRecordSet: recordToDelete
        });
    }

    // Then, upsert the new record
    changes.push({
        Action: 'UPSERT',
        ResourceRecordSet: {
            Name: recordName,
            Type: 'A',
            AliasTarget: {
                HostedZoneId: targetZoneId,
                DNSName: newTargetDnsName,
                EvaluateTargetHealth: false
            }
        }
    });

    const command = new ChangeResourceRecordSetsCommand({
        HostedZoneId: hostedZoneId,
        ChangeBatch: {
            Changes: changes
        }
    });

    const response = await route53Client.send(command);

    return {
        statusCode: 200,
        changeId: response.ChangeInfo.Id,
        status: response.ChangeInfo.Status,
        recordName,
        recordsDeleted: recordsToDelete.length,
        detectedZoneId: !newTargetZoneId ? targetZoneId : undefined
    };
}

/**
 * Check Route53 change status
 * Handles the case where no change was needed (changeId is null)
 */
async function checkRoute53Change(event) {
    const {changeId} = event;

    // If changeId is null, it means the record was already configured correctly
    if (!changeId || changeId === null) {
        console.log('No Route53 change was needed, record was already configured correctly');
        return {
            statusCode: 200,
            isComplete: true,
            status: 'already-configured',
            changeId: null
        };
    }

    const command = new GetChangeCommand({
        Id: changeId
    });

    const response = await route53Client.send(command);

    return {
        statusCode: 200,
        isComplete: response.ChangeInfo.Status === 'INSYNC',
        status: response.ChangeInfo.Status,
        changeId
    };
}

/**
 * Send SNS notification
 */
async function sendNotification(event) {
    const {snsArn, subject, message} = event;

    const command = new PublishCommand({
        TopicArn: snsArn,
        Subject: subject,
        Message: message
    });

    await snsClient.send(command);

    return {
        statusCode: 200,
        status: 'notification-sent'
    };
}

/**
 * Update failover status in SSM Parameter Store
 */
async function updateFailoverStatus(event) {
    const {parameterName, stepName, executionArn} = event;

    console.log(`Updating failover status to step: ${stepName}`);

    const ssmClient = new SSMClient({});

    const statusData = {
        lastSuccessfulStep: stepName,
        executionArn: executionArn,
        timestamp: new Date().toISOString()
    };

    const command = new PutParameterCommand({
        Name: parameterName,
        Value: JSON.stringify(statusData),
        Type: 'String',
        Overwrite: true
    });

    await ssmClient.send(command);

    return {
        statusCode: 200,
        status: 'status-updated',
        stepName,
        timestamp: statusData.timestamp
    };
}

/**
 * Get failover status from SSM Parameter Store
 */
async function getFailoverStatus(event) {
    const {parameterName} = event;

    console.log(`Getting failover status from parameter: ${parameterName}`);

    const ssmClient = new SSMClient({});

    try {
        const command = new GetParameterCommand({
            Name: parameterName,
            WithDecryption: true
        });

        const response = await ssmClient.send(command);
        const paramValue = response.Parameter.Value;

        // Check if the parameter value is "initial" or not valid JSON
        if (paramValue === 'initial' || paramValue === 'Initial' || paramValue === 'INITIAL') {
            console.log(`Failover status is in initial state. No previous execution found.`);
            return {
                statusCode: 200,
                status: 'initial',
                lastSuccessfulStep: null,
                executionArn: null,
                timestamp: null
            };
        }

        // Try to parse as JSON
        let statusData;
        try {
            statusData = JSON.parse(paramValue);
        } catch (parseError) {
            console.warn(`Could not parse failover status as JSON. Value: ${paramValue}. Treating as initial state.`);
            return {
                statusCode: 200,
                status: 'invalid-format',
                lastSuccessfulStep: null,
                executionArn: null,
                timestamp: null
            };
        }

        return {
            statusCode: 200,
            status: 'status-retrieved',
            lastSuccessfulStep: statusData.lastSuccessfulStep,
            executionArn: statusData.executionArn,
            timestamp: statusData.timestamp
        };
    } catch (error) {
        if (error.name === 'ParameterNotFound') {
            console.log(`Failover status parameter not found. This is the first execution.`);
            return {
                statusCode: 200,
                status: 'not-found',
                lastSuccessfulStep: null,
                executionArn: null,
                timestamp: null
            };
        }
        throw error;
    }
}
