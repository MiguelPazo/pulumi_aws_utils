import json
import boto3
import os
from typing import Dict, Any

# Initialize ECS client
ecs_client = boto3.client('ecs')


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    try:
        print(f"Received event: {json.dumps(event)}")

        # Extract ECS service information from the event
        cluster_name = event.get('cluster_name')
        service_name = event.get('service_name')

        if not cluster_name or not service_name:
            raise ValueError("cluster_name and service_name are required in the event")

        print(f"Restarting ECS service: {service_name} in cluster: {cluster_name}")

        # Get current service details to retrieve the current task definition
        describe_response = ecs_client.describe_services(
            cluster=cluster_name,
            services=[service_name]
        )

        if not describe_response['services']:
            raise ValueError(f"Service {service_name} not found in cluster {cluster_name}")

        service = describe_response['services'][0]
        current_task_definition = service['taskDefinition']

        print(f"Current task definition: {current_task_definition}")

        # Force new deployment using the same task definition
        update_response = ecs_client.update_service(
            cluster=cluster_name,
            service=service_name,
            taskDefinition=current_task_definition,
            forceNewDeployment=True
        )

        print(f"Service restart initiated successfully")
        print(f"Deployment ID: {update_response['service']['deployments'][0]['id']}")

        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'ECS service restart initiated successfully',
                'cluster': cluster_name,
                'service': service_name,
                'taskDefinition': current_task_definition,
                'deploymentId': update_response['service']['deployments'][0]['id']
            })
        }

    except Exception as e:
        error_message = f"Error restarting ECS service: {str(e)}"
        print(error_message)

        return {
            'statusCode': 500,
            'body': json.dumps({
                'message': error_message,
                'error': str(e)
            })
        }
