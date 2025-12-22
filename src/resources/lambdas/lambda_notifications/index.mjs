/**
 * Lambda function to receive SNS notifications and send them to Slack
 */

/**
 * Main Lambda handler for processing SNS events and sending to Slack
 * @param {Object} event - SNS event data
 * @param {Object} context - Lambda context object
 */
export const handler = async (event, context) => {
    const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;

    if (!slackWebhookUrl) {
        console.error('SLACK_WEBHOOK_URL environment variable is not defined');
        return {
            statusCode: 500,
            body: JSON.stringify({error: 'Slack webhook URL not configured'})
        };
    }

    try {
        console.log('Received SNS event:', JSON.stringify(event, null, 2));

        // Process each SNS record
        const results = await Promise.all(
            event.Records.map(async (record) => {
                try {
                    const snsMessage = record.Sns;
                    const subject = snsMessage.Subject || 'AWS Notification';
                    const message = snsMessage.Message;
                    const timestamp = snsMessage.Timestamp;

                    // Parse alarm state from subject
                    let color = '#808080'; // default gray
                    let emoji = '🔔';
                    let iconEmoji = ':bell:';

                    if (subject.includes('ALARM ADMIN')) {
                        color = '#c6c600'; // yellow
                        emoji = '🔔';
                        iconEmoji = ':bell:';
                    } else if (subject.includes('ALARM')) {
                        color = '#FF0000'; // red
                        emoji = '🚨';
                        iconEmoji = ':rotating_light:';
                    } else if (subject.includes('OK')) {
                        color = '#36A64F'; // green
                        emoji = '✅';
                        iconEmoji = ':white_check_mark:';
                    } else if (subject.includes('INSUFFICIENT_DATA')) {
                        color = '#FFA500'; // orange
                        emoji = '⚠️';
                        iconEmoji = ':warning:';
                    }

                    // Build Slack message payload
                    const slackPayload = {
                        icon_emoji: iconEmoji,
                        attachments: [
                            {
                                color: color,
                                title: `${emoji} ${subject}`,
                                text: message,
                                footer: 'AWS CloudWatch Alarms',
                                ts: Math.floor(new Date(timestamp).getTime() / 1000),
                                mrkdwn_in: ['text']
                            }
                        ]
                    };

                    // Send to Slack
                    const response = await fetch(slackWebhookUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(slackPayload)
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`Slack API error: ${response.status} - ${errorText}`);
                    }

                    console.log(`Successfully sent notification to Slack for: ${subject}`);
                    return {success: true, subject};

                } catch (error) {
                    console.error('Error processing SNS record:', error);
                    return {success: false, error: error.message};
                }
            })
        );

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        console.log(`Processed ${results.length} records: ${successCount} successful, ${failCount} failed`);

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Notifications processed',
                total: results.length,
                successful: successCount,
                failed: failCount
            })
        };

    } catch (error) {
        console.error('Error in Lambda handler:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Failed to process notifications',
                message: error.message
            })
        };
    }
};
