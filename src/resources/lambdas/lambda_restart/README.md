# Lambda ECS Restart

This Lambda function restarts ECS services using the current task definition version.

## File Structure

- `main.py`: Lambda function code in Python 3.12
- `policy.json`: IAM policy for the Lambda (ECS, CloudWatch Logs, and VPC permissions)

## Usage

To deploy this Lambda, use the `LambdaRestart` module in your Pulumi code:

```typescript
import {LambdaRestart} from "./src/tools/LambdaRestart";
import {VpcImport} from "./src/modules/VpcImport";

// Assume you have already imported your VPC
const vpc = await VpcImport.getInstance().main();

// Assume you have security groups already created
const securityGroups = [mySecurityGroup1, mySecurityGroup2];

// Configure and deploy the Lambda with EventBridge
await LambdaRestart.getInstance().main(
    {
        lambdaName: "ecs-restart",
        cronExpression: "cron(0 2 * * ? *)",  // Run at 2 AM every day
        eventData: {
            cluster_name: "my-ecs-cluster",
            service_name: "my-service"
        }
    },
    vpc,
    securityGroups
);
```

## Configuration Parameters

### Config Object (first parameter)
- **lambdaName**: Lambda function name
- **cronExpression**: Cron expression for the EventBridge rule (AWS EventBridge format)
- **eventData**: JSON object with ECS service data:
  - `cluster_name`: ECS cluster name
  - `service_name`: ECS service name

### VPC Configuration (second parameter)
- **vpc**: `pulumi.Output<VpcImportResult>` - The VPC where the Lambda will be deployed
  - The Lambda will be attached to the **private subnets** of the VPC

### Security Groups (third parameter)
- **securityGroups**: `pulumi.Output<aws.ec2.SecurityGroup>[]` - Array of security groups to attach to the Lambda

## Cron Expression Format

EventBridge uses the following format for cron expressions:

```
cron(minutes hours day-of-month month day-of-week year)
```

Examples:
- `cron(0 2 * * ? *)` - Every day at 2:00 AM
- `cron(0 */4 * * ? *)` - Every 4 hours
- `cron(0 0 ? * MON *)` - Every Monday at midnight
- `rate(1 hour)` - Every hour (alternative format)

## How It Works

1. EventBridge executes the Lambda according to the configured cron schedule
2. The Lambda (deployed in VPC private subnets) receives the event with `cluster_name` and `service_name`
3. The Lambda retrieves the current task definition of the service via ECS API
4. The Lambda forces a new deployment using `forceNewDeployment=True`
5. ECS restarts the containers with the same task definition version

## VPC Configuration

The Lambda is deployed within a VPC with the following configuration:
- **Subnets**: Attached to private subnets from the VPC
- **Security Groups**: Uses the provided security groups for network access control
- **Network Access**: Requires NAT Gateway in private subnets for accessing AWS APIs (ECS, CloudWatch Logs)

## IAM Permissions

The Lambda has permissions to:
- **CloudWatch Logs**: Create log groups, log streams, and write log events
- **VPC/EC2**: Create, delete, and describe network interfaces (required for VPC Lambda)
- **ECS**: Describe and update ECS services
  - `ecs:DescribeServices` - Get current task definition
  - `ecs:UpdateService` - Force new deployment

## Important Notes

1. **NAT Gateway Required**: Since the Lambda is deployed in private subnets, ensure your VPC has a NAT Gateway configured in the route tables of the private subnets. This allows the Lambda to communicate with AWS services (ECS API, CloudWatch Logs).

2. **Security Groups**: Configure the security groups to allow:
   - Outbound traffic to AWS services (HTTPS/443)
   - Any additional network access required by your Lambda

3. **Timeout**: The Lambda has a 60-second timeout configured, which should be sufficient for ECS service restart operations.
