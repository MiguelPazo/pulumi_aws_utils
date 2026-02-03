import {PublishCommand, SNSClient} from '@aws-sdk/client-sns';
import {CloudWatchClient, ListTagsForResourceCommand} from '@aws-sdk/client-cloudwatch';
import {SSMClient, GetParameterCommand} from '@aws-sdk/client-ssm';

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
            REGION: process.env.REGION,
            SNS_TOPIC_ARN: process.env.SNS_TOPIC_ARN
        };
    }

    return ENV_CONFIG;
}

// Initialize clients (will be configured after loading environment)
let snsClient;
let cloudwatchClient;

/**
 * Main Lambda handler for processing CloudWatch alarm events
 * @param {Object} event - CloudWatch alarm event data or EventBridge alarm-admin event
 * @param {Object} context - Lambda context object
 */
export const handler = async (event, context) => {
    // Load environment configuration
    const config = await loadEnvironment();

    // Initialize clients if not already initialized
    if (!snsClient) {
        snsClient = new SNSClient({region: config.REGION});
        cloudwatchClient = new CloudWatchClient({region: config.REGION});
    }

    const topicArn = config.SNS_TOPIC_ARN;

    if (!topicArn) {
        console.log(JSON.stringify({
            alarm: event.alarmData?.alarmName || event.type,
            message: 'SNS Topic not defined'
        }));
        return;
    }

    // Check if this is an alarm-admin event from EventBridge
    if (event.type === 'alarm-admin') {
        await handleAlarmAdminEvent(event, topicArn, config);
        return;
    }

    // Determine if this is an EventBridge CloudWatch Alarm State Change event or legacy format
    let alarmData, alarmArn, accountId;

    if (event['detail-type'] === 'CloudWatch Alarm State Change') {
        // EventBridge format (standard when CloudWatch invokes Lambda directly)
        alarmData = event.detail || {};
        alarmArn = event.resources?.[0] || '';
        accountId = event.account || '';
    } else {
        // Legacy custom format (for backwards compatibility)
        alarmData = event.alarmData || {};
        alarmArn = event.alarmArn || '';
        accountId = event.accountId || '';
    }

    const alarmName = alarmData.alarmName || '';
    const newState = alarmData.state?.value || '';
    const previousState = alarmData.previousState?.value || '';
    const region = event.region || config.REGION;

    // Skip notification for INSUFFICIENT_DATA to OK transitions
    if (previousState === 'INSUFFICIENT_DATA' && newState === 'OK') {
        console.log(JSON.stringify({
            alarm: alarmName,
            message: 'Notification not sent because alarm status change from INSUFFICIENT_DATA to OK'
        }));
        return;
    }

    // Get alarm tags
    const tags = await getAlarmTags(alarmArn);

    // Build alarm console link
    const encodedAlarmName = encodeURIComponent(alarmName);
    const alarmLink = `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#alarmsV2:alarm/${encodedAlarmName}`;

    // Build message
    const messageParts = [
        `Name: ${alarmName}`,
        `Description: ${alarmData.configuration?.description || ''}`,
        `Project: ${getTagValue(tags, 'project_full')}`,
        `State Change: ${previousState} -> ${newState}`,
        `Reason for State Change: ${alarmData.state?.reason || ''}`,
        `Timestamp: ${alarmData.state?.timestamp || ''}`,
        `AWS Account: ${accountId}`,
        `Alarm Arn: ${alarmArn}`,
        `Alarm Link: ${alarmLink}`
    ];

    // Build subject
    const project = getTagValue(tags, 'project_full');
    const environment = getTagValue(tags, 'environment');
    const serviceName = getTagValue(tags, 'service_name');
    const subject = `${newState}: AWS/${accountId}/${project} - [${environment}][${serviceName}][${region}]`;

    // Prepare SNS publish parameters
    const params = {
        Message: messageParts.join('\n\n') + '\n',
        Subject: subject,
        TopicArn: topicArn
    };

    // Publish to SNS
    try {
        const command = new PublishCommand(params);
        await snsClient.send(command);
        console.log(JSON.stringify({
            alarm: alarmName,
            message: `Message sent to SNS: ${topicArn}`
        }));
    } catch (err) {
        console.log(JSON.stringify({
            alarm: alarmName,
            message: `Error sending message to SNS: ${err.message}`
        }));
    }
};

/**
 * Handle alarm-admin events from EventBridge
 * @param {Object} event - Alarm admin event data
 * @param {string} topicArn - SNS topic ARN
 * @param {Object} config - Environment configuration
 */
async function handleAlarmAdminEvent(event, topicArn, config) {
    const {
        title = 'Unknown',
        event: eventName = '',
        user = '',
        account = '',
        stack = '',
        region: eventRegion = '',
        time = '',
        bucket = '',
        sourceIp = '',
        userAgent = '',
        project = 'project'
    } = event;

    // Build subject
    const subject = `ALARM ADMIN: AWS/${account}/${project} - [${stack}][${title}][${eventRegion}]`;

    // Build message parts
    const messageParts = [
        `${title} Detected!`,
        '',
        `Event: ${eventName}`,
        `User: ${user}`,
        `Account: ${account}`,
        `Stack: ${stack}`,
        `Region: ${eventRegion}`,
        `Time: ${time}`
    ];

    // Add optional fields if present
    if (bucket) {
        messageParts.push(`Bucket: ${bucket}`);
    }
    if (sourceIp) {
        messageParts.push(`Source IP: ${sourceIp}`);
    }
    if (userAgent) {
        messageParts.push(`User Agent: ${userAgent}`);
    }

    // Prepare SNS publish parameters
    const params = {
        Message: messageParts.join('\n'),
        Subject: subject,
        TopicArn: topicArn
    };

    // Publish to SNS
    try {
        const command = new PublishCommand(params);
        await snsClient.send(command);
        console.log(JSON.stringify({
            type: 'alarm-admin',
            title,
            event: eventName,
            message: `Message sent to SNS: ${topicArn}`
        }));
    } catch (err) {
        console.log(JSON.stringify({
            type: 'alarm-admin',
            title,
            event: eventName,
            message: `Error sending message to SNS: ${err.message}`
        }));
    }
}

/**
 * Retrieve tags for a CloudWatch alarm
 * @param {string} alarmArn - ARN of the CloudWatch alarm
 * @returns {Array<Object>} List of tag objects with "Key" and "Value"
 */
async function getAlarmTags(alarmArn) {
    try {
        const command = new ListTagsForResourceCommand({
            ResourceARN: alarmArn
        });
        const response = await cloudwatchClient.send(command);
        return response.Tags || [];
    } catch (error) {
        console.error(`Error retrieving tags for alarm: ${alarmArn} - ${error.message}`);
        return [];
    }
}

/**
 * Get value of a specific tag by key
 * @param {Array<Object>} tags - List of tag objects
 * @param {string} key - Tag key to search for
 * @param {*} defaultValue - Default value if tag not found
 * @returns {*} Tag value or default
 */
function getTagValue(tags, key, defaultValue = null) {
    const tag = tags.find(t => t.Key === key);
    return tag ? tag.Value : defaultValue;
}
