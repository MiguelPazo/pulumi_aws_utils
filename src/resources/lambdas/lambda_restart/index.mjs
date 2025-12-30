import {DescribeServicesCommand, ECSClient, UpdateServiceCommand} from '@aws-sdk/client-ecs';

// Initialize ECS client
const ecsClient = new ECSClient({});

/**
 * Lambda handler for restarting ECS services
 * @param {Object} event - Lambda event containing cluster_name and service_name
 * @param {Object} context - Lambda context
 * @returns {Object} Response with status code and body
 */
export const handler = async (event, context) => {
    try {
        console.log(`Received event: ${JSON.stringify(event)}`);

        // Extract ECS service information from the event
        const clusterName = event.cluster_name;
        const serviceName = event.service_name;

        if (!clusterName || !serviceName) {
            throw new Error('cluster_name and service_name are required in the event');
        }

        console.log(`Restarting ECS service: ${serviceName} in cluster: ${clusterName}`);

        // Get current service details to retrieve the current task definition
        const describeCommand = new DescribeServicesCommand({
            cluster: clusterName,
            services: [serviceName]
        });

        const describeResponse = await ecsClient.send(describeCommand);

        if (!describeResponse.services || describeResponse.services.length === 0) {
            throw new Error(`Service ${serviceName} not found in cluster ${clusterName}`);
        }

        const service = describeResponse.services[0];
        const currentTaskDefinition = service.taskDefinition;

        console.log(`Current task definition: ${currentTaskDefinition}`);

        // Force new deployment using the same task definition
        const updateCommand = new UpdateServiceCommand({
            cluster: clusterName,
            service: serviceName,
            taskDefinition: currentTaskDefinition,
            forceNewDeployment: true
        });

        const updateResponse = await ecsClient.send(updateCommand);

        console.log('Service restart initiated successfully');
        console.log(`Deployment ID: ${updateResponse.service.deployments[0].id}`);

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'ECS service restart initiated successfully',
                cluster: clusterName,
                service: serviceName,
                taskDefinition: currentTaskDefinition,
                deploymentId: updateResponse.service.deployments[0].id
            })
        };

    } catch (error) {
        const errorMessage = `Error restarting ECS service: ${error.message}`;
        console.error(errorMessage);

        return {
            statusCode: 500,
            body: JSON.stringify({
                message: errorMessage,
                error: error.message
            })
        };
    }
};
