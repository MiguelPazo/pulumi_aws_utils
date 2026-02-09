# ParamStore Configuration

This directory contains AWS Systems Manager Parameter Store configurations.

## Directory Structure

```
params/
├── _general/          # Parameters shared across all stacks
│   ├── *.json        # JSON files with parameter definitions
│   └── values/       # JSON files referenced by parameters in _general
│       └── *.json    # Reusable JSON configurations
└── {stack}/          # Stack-specific parameters (e.g., dev, staging, prod)
    ├── *.json        # JSON files with parameter definitions
    └── values/       # JSON files referenced by parameters in stack
        └── *.json    # Reusable JSON configurations
```

## Parameter Format

Each JSON file should contain an array of parameter configurations:

```json
[
  {
    "name": "/path/to/parameter",
    "type": "String|SecureString|StringList",
    "value": "parameter-value",
    "description": "Optional description",
    "ignoreChanges": false
  }
]
```

### Fields

- **name** (required): The parameter path (will be prefixed with `/{generalPrefix}`)
- **type** (required): Parameter type
    - `String`: Plain text parameter
    - `SecureString`: Encrypted parameter (requires KMS key)
    - `StringList`: Comma-separated list of values
- **value** (required): The parameter value (supports placeholders - see below)
- **description** (optional): Description of the parameter
- **ignoreChanges** (optional): If true, Pulumi will ignore changes to the value after creation

### Placeholders

Parameter values support automatic replacement of the following placeholders:

- **`rep_region`**: Replaced with AWS region (e.g., `us-east-1`)
- **`rep_accountid`**: Replaced with AWS account ID
- **`rep_general_prefix`**: Replaced with general prefix (e.g., `my-app-dev`)
- **`rep_general_prefix_multiregion`**: Replaced with multiregion prefix
- **`rep_stack_alias`**: Replaced with stack alias (or stack if not defined)
- **`rep_project`**: Replaced with project name
- **`rep_stack`**: Replaced with stack name (e.g., `dev`, `prod`)

Example:

```json
{
  "name": "/database/host",
  "type": "String",
  "value": "db.rep_stack.rep_region.rds.amazonaws.com"
}
```

This would create a parameter with value like: `db.prod.us-east-1.rds.amazonaws.com`

### File References

For complex JSON configurations (like Step Functions or multi-region failover configs), you can reference external JSON
files using the syntax `[[filename.json]]`:

```json
{
  "name": "/config/failover",
  "type": "SecureString",
  "value": "[[failover.json]]",
  "description": "Multi-region failover configuration",
  "ignoreChanges": true
}
```

**How it works:**

1. The value `[[failover.json]]` tells ParamStore to load the file from the `values/` subdirectory within the current
   directory (e.g., `_general/values/failover.json` or `{stack}/values/failover.json`)
2. The JSON file is read and validated
3. Placeholders (like `rep_accountid`, `rep_region`) are replaced in the JSON content
4. The resulting JSON is minified and stored as a string in SSM Parameter Store

**Benefits:**

- Keep complex configurations in separate, manageable files
- Reuse configurations across multiple parameters
- Version control large JSON structures separately
- Automatic validation of JSON syntax
- Support for placeholders within referenced files

**Example _general/values/failover.json:**

```json
{
  "primaryRegion": "us-east-1",
  "secondaryRegion": "us-west-2",
  "cloudFront": [
    {
      "distributionId": "E1234567890ABC",
      "type": "backend",
      "aliasesToRemove": ["api.example.com"],
      "shouldDisable": true
    },
    {
      "distributionId": "E0987654321XYZ",
      "type": "frontend",
      "aliasesToRemove": ["app.example.com"],
      "shouldDisable": true
    }
  ],
  "s3Buckets": [
    {
      "bucketName": "rep_general_prefix_multiregion-rep_accountid-assets",
      "region": "us-east-1"
    },
    {
      "bucketName": "rep_general_prefix_multiregion-rep_accountid-uploads"
    }
  ],
  "rds": {
    "globalClusterId": "rep_general_prefix_multiregion-postgres-global",
    "secondaryClusterArn": "arn:aws:rds:us-west-2:rep_accountid:cluster:rep_general_prefix_multiregion-postgres-rep_stack-us-west-2",
    "secondaryClusterRegion": "us-west-2"
  },
  "efs": [
    {
      "sourceFileSystemId": "fs-0123456789abcdef0"
    }
  ],
  "ecsServices": [
    {
      "clusterName": "rep_general_prefix-ecs-cluster",
      "serviceName": "rep_general_prefix-backend",
      "forceUpdate": true,
      "region": "us-west-2"
    },
    {
      "clusterName": "rep_general_prefix-ecs-cluster",
      "serviceName": "rep_general_prefix-worker"
    }
  ],
  "eventBridgeRules": [
    {
      "ruleName": "scheduled-backup",
      "region": "us-east-1",
      "shouldDisable": true,
      "shouldEnable": false
    },
    {
      "ruleName": "scheduled-backup",
      "region": "us-west-2",
      "shouldDisable": false,
      "shouldEnable": true
    }
  ],
  "route53Records": [
    {
      "hostedZoneId": "Z1234567890ABC",
      "recordName": "app.example.com",
      "newTargetDnsName": "d111111abcdef8.cloudfront.net"
    }
  ]
}
```

**Example with empty ECS array (minimal configuration):**

```json
{
  "primaryRegion": "us-east-1",
  "secondaryRegion": "us-west-2",
  "cloudFront": [...],
  "s3Buckets": [...],
  "rds": {...},
  "efs": [...],
  "ecsServices": [],
  "eventBridgeRules": [...],
  "route53Records": [...]
}
```

**Configuration Fields:**

- **primaryRegion** (required): The primary AWS region where resources are currently running
- **secondaryRegion** (required): The secondary AWS region for failover
- **cloudFront** (optional): Array of CloudFront distributions to manage during failover
    - **distributionId** (required): CloudFront distribution ID
    - **type** (required): Distribution type - `"backend"` (disabled at start) or `"frontend"` (disabled at end)
    - **aliasesToRemove** (optional): Array of domain aliases to remove before disabling
    - **shouldDisable** (required): Whether to disable this distribution during failover
- **s3Buckets** (optional): Array of S3 buckets to validate replication status
    - **bucketName** (required): Name of the S3 bucket
    - **region** (optional): AWS region where the bucket is located. If not specified, uses `primaryRegion`
- **rds** (optional): RDS Aurora Global Cluster configuration for promotion
    - **globalClusterId** (required): The identifier of the Aurora Global Database cluster
    - **secondaryClusterArn** (required): The full ARN of the secondary cluster to promote (e.g., `arn:aws:rds:us-west-2:123456789012:cluster:my-cluster-name`)
    - **secondaryClusterRegion** (required): The AWS region where the secondary cluster is located
- **efs** (optional): Array of EFS filesystems to disable replication (uses `sourceFileSystemId` from primary region)
- **ecsServices** (required): Array of ECS services to manage during failover (can be empty array `[]`)
    - **clusterName** (required): Name of the ECS cluster
    - **serviceName** (required): Name of the ECS service
    - **forceUpdate** (optional, boolean): If `true`, updates the service to the latest revision of its current task definition family. If `false` or omitted, restarts the service with the same task definition (force new deployment). Default: `false`
    - **region** (optional): AWS region where the ECS service is located. If not specified, uses `secondaryRegion`
- **eventBridgeRules** (optional): Array of EventBridge rules to enable/disable during failover
    - **ruleName** (required): Name of the EventBridge rule
    - **region** (required): AWS region where the rule is located
    - **shouldDisable** (required): `true` to disable the rule during the first phase (typically primary region rules)
    - **shouldEnable** (required): `true` to enable the rule during the second phase (typically secondary region rules)
    - **Note**: Rules are processed in two sequential phases to prevent desynchronization:
        1. **Disable Phase**: All rules with `shouldDisable: true` are disabled first
        2. **Enable Phase**: All rules with `shouldEnable: true` are enabled after disabling is complete
- **route53Records** (optional): Array of DNS records to update (auto-detects hosted zone IDs)

## Usage Example

```typescript
import {AwsUtilsModules} from 'pulumi_aws_utils';

const kmsKey = await AwsUtilsModules.Kms.getInstance().main({
    name: 'ssm-params'
});

await AwsUtilsModules.ParamStore.getInstance().main({
    paramsPath: './src/resources/params',
    kmsKey: kmsKey.key
});
```

## Behavior

1. **_general directory**: Parameters in this directory are created for all stacks
    - If the directory doesn't exist, a log message is displayed

2. **{stack} directory**: Parameters specific to the current stack (e.g., `dev`, `prod`)
    - If the directory doesn't exist, a log message is displayed

3. **Naming**: All parameters are prefixed with `/{generalPrefix}/` where slashes replace dashes
    - Example: If `generalPrefix` is `my-app-dev`, parameters are created under `/my/app/dev/`

4. **KMS Encryption**:
    - If a KMS key is provided and parameter type is `SecureString`, the parameter will be encrypted
    - For other types, the KMS key is not used

5. **Tags**: Each parameter is tagged with:
    - General tags from the config
    - `Name`: The full parameter path
    - `Source`: The directory name (`_general` or stack name)
