/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 * Lambda Function for Multi-Region Failover Operations
 */

import {DescribeDBClustersCommand, FailoverGlobalClusterCommand, RDSClient} from "@aws-sdk/client-rds";
import {
    DeleteReplicationConfigurationCommand,
    DescribeFileSystemsCommand,
    DescribeReplicationConfigurationsCommand,
    EFSClient
} from "@aws-sdk/client-efs";
import {GetBucketReplicationCommand, S3Client} from "@aws-sdk/client-s3";
import {CloudFrontClient, GetDistributionConfigCommand, UpdateDistributionCommand} from "@aws-sdk/client-cloudfront";
import {ChangeResourceRecordSetsCommand, GetChangeCommand, Route53Client} from "@aws-sdk/client-route53";
import {PublishCommand, SNSClient} from "@aws-sdk/client-sns";
import {CloudWatchClient, GetMetricStatisticsCommand} from "@aws-sdk/client-cloudwatch";
import {DescribeServicesCommand, ECSClient, UpdateServiceCommand} from "@aws-sdk/client-ecs";
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
            case 'update-ecs-service':
                return await updateEcsService(event);
            case 'check-ecs-deployment':
                return await checkEcsDeployment(event);
            case 'restart-ecs-service':
                return await restartEcsService(event);
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
 */
async function promoteRdsCluster(event) {
    const {globalClusterId, secondaryClusterId, secondaryRegion} = event;

    console.log(`Promoting secondary cluster ${secondaryClusterId} in region ${secondaryRegion}`);

    const secondaryRdsClient = new RDSClient({region: secondaryRegion});

    // Initiate failover to promote secondary
    const command = new FailoverGlobalClusterCommand({
        GlobalClusterIdentifier: globalClusterId,
        TargetDbClusterIdentifier: secondaryClusterId
    });

    await secondaryRdsClient.send(command);

    return {
        statusCode: 200,
        globalClusterId,
        secondaryClusterId,
        status: 'promotion-initiated'
    };
}

/**
 * Check RDS cluster promotion status
 */
async function checkRdsPromotion(event) {
    const {secondaryClusterId, secondaryRegion} = event;

    const secondaryRdsClient = new RDSClient({region: secondaryRegion});

    const command = new DescribeDBClustersCommand({
        DBClusterIdentifier: secondaryClusterId
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
        clusterId: secondaryClusterId
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
}

/**
 * Check EFS status after disabling replication
 */
async function checkEfsStatus(event) {
    const {destinationFileSystemId, destinationRegion} = event;

    const destinationEfsClient = new EFSClient({region: destinationRegion});

    const command = new DescribeFileSystemsCommand({
        FileSystemId: destinationFileSystemId
    });

    const response = await destinationEfsClient.send(command);
    const fs = response.FileSystems[0];

    const isComplete = fs.LifeCycleState === 'available';

    return {
        statusCode: 200,
        isComplete,
        status: fs.LifeCycleState,
        fileSystemId: destinationFileSystemId
    };
}

/**
 * Check S3 replication status using CloudWatch metrics
 */
async function checkS3Replication(event) {
    const {bucketName} = event;

    console.log(`Checking S3 replication status for ${bucketName}`);

    // Get replication configuration
    const replicationCommand = new GetBucketReplicationCommand({
        Bucket: bucketName
    });

    const replicationConfig = await s3Client.send(replicationCommand);

    // Check replication metrics
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

    const metricsResponse = await cloudWatchClient.send(metricsCommand);

    const latency = metricsResponse.Datapoints.length > 0
        ? metricsResponse.Datapoints[0].Maximum
        : 0;

    const isSynced = latency < 900; // Less than 15 minutes

    return {
        statusCode: 200,
        bucketName,
        isSynced,
        latency,
        replicationEnabled: !!replicationConfig.ReplicationConfiguration
    };
}

/**
 * Update ECS service with a specific task definition and revision
 */
async function updateEcsService(event) {
    const {clusterName, serviceName, taskDefinition, taskDefinitionRevision} = event;

    console.log(`Updating ECS service ${serviceName} in cluster ${clusterName} with task definition ${taskDefinition}:${taskDefinitionRevision}`);

    // Build full task definition ARN
    const fullTaskDefinition = `${taskDefinition}:${taskDefinitionRevision}`;

    // Get current service configuration to preserve desired count
    const describeCommand = new DescribeServicesCommand({
        cluster: clusterName,
        services: [serviceName]
    });

    const describeResponse = await ecsClient.send(describeCommand);

    if (!describeResponse.services || describeResponse.services.length === 0) {
        throw new Error(`Service ${serviceName} not found in cluster ${clusterName}`);
    }

    const service = describeResponse.services[0];
    const currentDesiredCount = service.desiredCount;

    console.log(`Current desired count: ${currentDesiredCount}`);

    // Update service with new task definition
    const updateCommand = new UpdateServiceCommand({
        cluster: clusterName,
        service: serviceName,
        taskDefinition: fullTaskDefinition,
        desiredCount: currentDesiredCount,
        forceNewDeployment: false
    });

    const updateResponse = await ecsClient.send(updateCommand);

    return {
        statusCode: 200,
        clusterName,
        serviceName,
        taskDefinition: fullTaskDefinition,
        desiredCount: currentDesiredCount,
        deploymentId: updateResponse.service.deployments[0]?.id,
        status: 'update-initiated'
    };
}

/**
 * Check ECS deployment status
 */
async function checkEcsDeployment(event) {
    const {clusterName, serviceName, deploymentId} = event;

    console.log(`Checking ECS deployment ${deploymentId} for service ${serviceName} in cluster ${clusterName}`);

    const describeCommand = new DescribeServicesCommand({
        cluster: clusterName,
        services: [serviceName]
    });

    const describeResponse = await ecsClient.send(describeCommand);

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
 * Restart ECS service with same task definition version and desired count
 */
async function restartEcsService(event) {
    const {clusterName, serviceName} = event;

    console.log(`Restarting ECS service ${serviceName} in cluster ${clusterName}`);

    // Get current service configuration
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
    const currentDesiredCount = service.desiredCount;

    console.log(`Current task definition: ${currentTaskDefinition}`);
    console.log(`Current desired count: ${currentDesiredCount}`);

    // Force new deployment with same configuration
    const updateCommand = new UpdateServiceCommand({
        cluster: clusterName,
        service: serviceName,
        taskDefinition: currentTaskDefinition,
        desiredCount: currentDesiredCount,
        forceNewDeployment: true
    });

    const updateResponse = await ecsClient.send(updateCommand);

    return {
        statusCode: 200,
        clusterName,
        serviceName,
        taskDefinition: currentTaskDefinition,
        desiredCount: currentDesiredCount,
        deploymentId: updateResponse.service.deployments[0]?.id,
        status: 'restart-initiated'
    };
}

/**
 * Disable EventBridge Rule
 */
async function disableEventBridgeRule(event) {
    const {ruleName, targetRegion} = event;

    console.log(`Disabling EventBridge rule ${ruleName} in region ${targetRegion}`);

    const regionEventBridgeClient = new EventBridgeClient({region: targetRegion});

    // First, check if the rule exists
    try {
        const describeCommand = new DescribeRuleCommand({
            Name: ruleName
        });

        await regionEventBridgeClient.send(describeCommand);
    } catch (error) {
        if (error.name === 'ResourceNotFoundException') {
            console.warn(`Rule ${ruleName} not found in region ${targetRegion}`);
            return {
                statusCode: 200,
                ruleName,
                region: targetRegion,
                state: 'not-found',
                status: 'rule-not-found'
            };
        }
        throw error;
    }

    // Disable the rule
    const disableCommand = new DisableRuleCommand({
        Name: ruleName
    });
    await regionEventBridgeClient.send(disableCommand);

    return {
        statusCode: 200,
        ruleName,
        region: targetRegion,
        state: 'DISABLED',
        status: 'disabled'
    };
}

/**
 * Enable EventBridge Rule
 */
async function enableEventBridgeRule(event) {
    const {ruleName, targetRegion} = event;

    console.log(`Enabling EventBridge rule ${ruleName} in region ${targetRegion}`);

    const regionEventBridgeClient = new EventBridgeClient({region: targetRegion});

    // First, check if the rule exists
    try {
        const describeCommand = new DescribeRuleCommand({
            Name: ruleName
        });

        await regionEventBridgeClient.send(describeCommand);
    } catch (error) {
        if (error.name === 'ResourceNotFoundException') {
            console.warn(`Rule ${ruleName} not found in region ${targetRegion}`);
            return {
                statusCode: 200,
                ruleName,
                region: targetRegion,
                state: 'not-found',
                status: 'rule-not-found'
            };
        }
        throw error;
    }

    // Enable the rule
    const enableCommand = new EnableRuleCommand({
        Name: ruleName
    });
    await regionEventBridgeClient.send(enableCommand);

    return {
        statusCode: 200,
        ruleName,
        region: targetRegion,
        state: 'ENABLED',
        status: 'enabled'
    };
}

/**
 * Remove aliases from CloudFront distribution
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

    await cloudFrontClient.send(updateCommand);

    return {
        statusCode: 200,
        distributionId,
        aliasesRemoved: aliasesToRemove,
        status: 'aliases-removed'
    };
}

/**
 * Disable CloudFront distribution
 */
async function disableCloudFront(event) {
    const {distributionId} = event;

    console.log(`Disabling CloudFront distribution ${distributionId}`);

    const getCommand = new GetDistributionConfigCommand({
        Id: distributionId
    });

    const {DistributionConfig, ETag} = await cloudFrontClient.send(getCommand);

    // Disable the distribution
    DistributionConfig.Enabled = false;

    const updateCommand = new UpdateDistributionCommand({
        Id: distributionId,
        DistributionConfig,
        IfMatch: ETag
    });

    await cloudFrontClient.send(updateCommand);

    return {
        statusCode: 200,
        distributionId,
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

        await cloudFrontClient.send(updateCommand);
    }

    return {
        statusCode: 200,
        distributionId,
        aliasesAdded,
        status: 'aliases-added'
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

    await cloudFrontClient.send(updateCommand);

    return {
        statusCode: 200,
        distributionId,
        status: 'enabled'
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
 * Update Route53 DNS record
 * Automatically detects the target hosted zone ID if not provided
 */
async function updateRoute53Record(event) {
    const {hostedZoneId, recordName, newTargetDnsName, newTargetZoneId} = event;

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

    const command = new ChangeResourceRecordSetsCommand({
        HostedZoneId: hostedZoneId,
        ChangeBatch: {
            Changes: [
                {
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
                }
            ]
        }
    });

    const response = await route53Client.send(command);

    return {
        statusCode: 200,
        changeId: response.ChangeInfo.Id,
        status: response.ChangeInfo.Status,
        recordName,
        detectedZoneId: !newTargetZoneId ? targetZoneId : undefined
    };
}

/**
 * Check Route53 change status
 */
async function checkRoute53Change(event) {
    const {changeId} = event;

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
            Name: parameterName
        });

        const response = await ssmClient.send(command);
        const statusData = JSON.parse(response.Parameter.Value);

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
