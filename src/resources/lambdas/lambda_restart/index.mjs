import {DescribeServicesCommand, ECSClient, UpdateServiceCommand} from '@aws-sdk/client-ecs';
import {GetParameterCommand, SSMClient} from '@aws-sdk/client-ssm';

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
            LOG_LEVEL: process.env.LOG_LEVEL || "INFO"
        };
    }

    return ENV_CONFIG;
}

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
        // Load environment configuration on first invocation
        const config = await loadEnvironment();

        console.log(`Received event: ${JSON.stringify(event)}`);
        console.log(`Log level: ${config.LOG_LEVEL}`);

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
