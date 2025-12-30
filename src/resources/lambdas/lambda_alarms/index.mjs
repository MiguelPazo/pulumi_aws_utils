import {PublishCommand, SNSClient} from '@aws-sdk/client-sns';
import {CloudWatchClient, ListTagsForResourceCommand} from '@aws-sdk/client-cloudwatch';

// Initialize clients
const region = process.env.REGION;
const snsClient = new SNSClient({region});
const cloudwatchClient = new CloudWatchClient({region});

/**
 * Main Lambda handler for processing CloudWatch alarm events
 * @param {Object} event - CloudWatch alarm event data or EventBridge alarm-admin event
 * @param {Object} context - Lambda context object
 */
export const handler = async (event, context) => {
    const topicArn = process.env.SNS_TOPIC_ARN;

    if (!topicArn) {
        console.log(JSON.stringify({
            alarm: event.alarmData?.alarmName || event.type,
            message: 'SNS Topic not defined'
        }));
        return;
    }

    // Check if this is an alarm-admin event from EventBridge
    if (event.type === 'alarm-admin') {
        await handleAlarmAdminEvent(event, topicArn);
        return;
    }

    // Standard CloudWatch Alarm processing
    const alarmData = event.alarmData || {};
    const alarmName = alarmData.alarmName || '';
    const newState = alarmData.state?.value || '';
    const previousState = alarmData.previousState?.value || '';
    const alarmArn = event.alarmArn || '';
    const accountId = event.accountId || '';

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
 */
async function handleAlarmAdminEvent(event, topicArn) {
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
        userAgent = ''
    } = event;

    // Build subject
    const subject = `ALARM ADMIN: AWS/${account}/${process.env.PROJECT || 'project'} - [${stack}][${title}][${eventRegion}]`;

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
