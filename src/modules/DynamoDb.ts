/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import {getInit} from "../config";
import {InitConfig} from "../types/module";
import {DynamoDbModuleConfig, DynamoDbResult, DynamoDbTableConfig} from "../types";
import * as pulumi from "@pulumi/pulumi";


class DynamoDb {
    private static __instance: DynamoDb;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): DynamoDb {
        if (this.__instance == null) {
            this.__instance = new DynamoDb();
        }

        return this.__instance;
    }

    async main(config: DynamoDbModuleConfig): Promise<DynamoDbResult> {
        const {
            tableConfigs,
            kmsKey,
            replicaRegion,
            replicaConfig,
            tablePrefix = "table",
            skipReplicaCreation = true,
            enableMultiregion = false
        } = config;

        const multiRegion = (enableMultiregion && this.config.multiRegion) || false;
        const failoverReplica = this.config.failoverReplica || false;
        const regionReplica = this.config.regionReplica;
        const providerReplica = this.config.providerReplica;

        /**
         * Handle failover replica scenario - get existing tables
         */
        if (multiRegion && failoverReplica) {
            if (!regionReplica) {
                throw new Error("regionReplica is required when failoverReplica is true");
            }

            const tables: { [key: string]: aws.dynamodb.Table } = {};
            const resourceOptions: pulumi.ResourceOptions = providerReplica ? {provider: providerReplica} : {};

            tableConfigs.forEach(tableConfig => {
                const tableKey = tableConfig.name;
                const replicaTableName = `${this.config.generalPrefixMultiregion}-${tablePrefix}-${tableConfig.name}`;

                const table = aws.dynamodb.Table.get(
                    `${this.config.project}-dynamodb-${tableConfig.name}-failover`,
                    replicaTableName,
                    undefined,
                    resourceOptions
                );

                tables[tableKey] = table;
            });

            return tables as DynamoDbResult;
        }

        const tables: { [key: string]: aws.dynamodb.Table } = {};

        tableConfigs.forEach(tableConfig => {
            const tableKey = tableConfig.name;
            const shouldSkipReplica = skipReplicaCreation && tableConfig.billingMode === "PROVISIONED";

            // Create DynamoDB table (without replicas if Auto Scaling is needed)
            const table = new aws.dynamodb.Table(`${this.config.project}-dynamodb-${tableConfig.name}`, {
                name: `${this.config.generalPrefix}-${tablePrefix}-${tableConfig.name}`,
                attributes: tableConfig.attributes,
                hashKey: tableConfig.hashKey,
                ...(tableConfig.rangeKey && {rangeKey: tableConfig.rangeKey}),
                billingMode: tableConfig.billingMode,
                ...(tableConfig.billingMode === "PROVISIONED" && {
                    readCapacity: tableConfig.readCapacity || tableConfig.autoScaling?.read?.minCapacity || 5,
                    writeCapacity: tableConfig.writeCapacity || tableConfig.autoScaling?.write?.minCapacity || 5
                }),
                ...(tableConfig.globalSecondaryIndexes && {
                    globalSecondaryIndexes: tableConfig.globalSecondaryIndexes.map(gsi => ({
                        name: gsi.name,
                        hashKey: gsi.hashKey,
                        ...(gsi.rangeKey && {rangeKey: gsi.rangeKey}),
                        projectionType: gsi.projectionType,
                        ...(gsi.projectionAttributes && {projectionAttributes: gsi.projectionAttributes}),
                        ...(tableConfig.billingMode === "PROVISIONED" && {
                            readCapacity: gsi.readCapacity || tableConfig.readCapacity || 5,
                            writeCapacity: gsi.writeCapacity || tableConfig.writeCapacity || 5
                        })
                    }))
                }),
                ...(tableConfig.localSecondaryIndexes && {
                    localSecondaryIndexes: tableConfig.localSecondaryIndexes
                }),
                // Enable streams if configured OR if using replicas (required for Global Tables)
                ...(tableConfig.streamEnabled || replicaRegion ? {
                    streamEnabled: true,
                    streamViewType: tableConfig.streamViewType || "NEW_AND_OLD_IMAGES"
                } : {}),
                serverSideEncryption: {
                    enabled: true,
                    ...(kmsKey && {kmsKeyArn: kmsKey.arn})
                },
                pointInTimeRecovery: {
                    enabled: tableConfig.pointInTimeRecovery || false
                },
                deletionProtectionEnabled: tableConfig.deleteProtection || false,
                // Only add replicas if not skipped (only skips for PROVISIONED mode)
                ...(!shouldSkipReplica && replicaRegion && {
                    replicas: [{
                        regionName: replicaRegion,
                        pointInTimeRecovery: replicaConfig?.pointInTimeRecovery ?? tableConfig.pointInTimeRecovery ?? false,
                        propagateTags: replicaConfig?.propagateTags ?? true,
                        ...(replicaConfig?.deletionProtectionEnabled !== undefined && {
                            deletionProtectionEnabled: replicaConfig.deletionProtectionEnabled
                        }),
                        // Use customer managed KMS key for replica encryption if provided
                        ...(replicaConfig?.kmsKey && {
                            kmsKeyArn: pulumi.output(replicaConfig.kmsKey).apply(k => k.arn)
                        })
                    }]
                }),
                tags: {
                    ...this.config.generalTags,
                    Name: `${this.config.generalPrefix}-${tablePrefix}-${tableConfig.name}`,
                    ...tableConfig.tags
                }
            });

            tables[tableKey] = table;

            // Configure Auto Scaling for table if enabled and billingMode is PROVISIONED
            // Note: With Global Tables, Auto Scaling policies are automatically replicated to all regions
            // Only create policies in the primary region (where the table is created)
            const autoScalingPolicies: pulumi.Resource[] = [];

            if (tableConfig.billingMode === "PROVISIONED" && tableConfig.autoScaling) {
                const tablePolicies = this.configureTableAutoScaling(tableConfig, table);
                autoScalingPolicies.push(...tablePolicies);
            }

            // Configure Auto Scaling for GSI if enabled
            if (tableConfig.billingMode === "PROVISIONED" && tableConfig.globalSecondaryIndexes) {
                tableConfig.globalSecondaryIndexes.forEach(gsi => {
                    // Apply table auto scaling to all GSI if flag is enabled
                    if (tableConfig.applyAutoScalingToAllGsi && tableConfig.autoScaling) {
                        const gsiPolicies = this.configureGsiAutoScaling(tableConfig, table, gsi.name, tableConfig.autoScaling);
                        autoScalingPolicies.push(...gsiPolicies);
                    }
                    // Apply specific GSI auto scaling configuration
                    else if (tableConfig.gsiAutoScaling && tableConfig.gsiAutoScaling[gsi.name]) {
                        const gsiPolicies = this.configureGsiAutoScaling(tableConfig, table, gsi.name, tableConfig.gsiAutoScaling[gsi.name]);
                        autoScalingPolicies.push(...gsiPolicies);
                    }
                });
            }

            // Log info about replica creation for PROVISIONED tables
            if (shouldSkipReplica && replicaRegion) {
                pulumi.log.info(
                    `Table ${tableConfig.name}: Skipping replica creation (PROVISIONED mode). ` +
                    `Set skipReplicaCreation=false in second deployment to add replicas.`,
                    table
                );
            }
        });

        return tables as DynamoDbResult;
    }

    private configureTableAutoScaling(config: DynamoDbTableConfig, table: aws.dynamodb.Table): pulumi.Resource[] {
        const policies: pulumi.Resource[] = [];
        // Read Auto Scaling
        if (config.autoScaling?.read?.enabled) {
            const readTarget = new aws.appautoscaling.Target(
                `${this.config.project}-dynamodb-${config.name}-read-target`,
                {
                    maxCapacity: config.autoScaling.read.maxCapacity,
                    minCapacity: config.autoScaling.read.minCapacity,
                    resourceId: pulumi.interpolate`table/${table.name}`,
                    scalableDimension: "dynamodb:table:ReadCapacityUnits",
                    serviceNamespace: "dynamodb",
                }
            );

            const readPolicy = new aws.appautoscaling.Policy(
                `${this.config.project}-dynamodb-${config.name}-read-policy`,
                {
                    policyType: "TargetTrackingScaling",
                    resourceId: readTarget.resourceId,
                    scalableDimension: readTarget.scalableDimension,
                    serviceNamespace: readTarget.serviceNamespace,
                    targetTrackingScalingPolicyConfiguration: {
                        predefinedMetricSpecification: {
                            predefinedMetricType: "DynamoDBReadCapacityUtilization",
                        },
                        targetValue: config.autoScaling.read.targetValue,
                        ...(config.autoScaling.read.scaleInCooldown && {
                            scaleInCooldown: config.autoScaling.read.scaleInCooldown
                        }),
                        ...(config.autoScaling.read.scaleOutCooldown && {
                            scaleOutCooldown: config.autoScaling.read.scaleOutCooldown
                        })
                    },
                }
            );
            policies.push(readPolicy);
        }

        // Write Auto Scaling
        if (config.autoScaling?.write?.enabled) {
            const writeTarget = new aws.appautoscaling.Target(
                `${this.config.project}-dynamodb-${config.name}-write-target`,
                {
                    maxCapacity: config.autoScaling.write.maxCapacity,
                    minCapacity: config.autoScaling.write.minCapacity,
                    resourceId: pulumi.interpolate`table/${table.name}`,
                    scalableDimension: "dynamodb:table:WriteCapacityUnits",
                    serviceNamespace: "dynamodb",
                }
            );

            const writePolicy = new aws.appautoscaling.Policy(
                `${this.config.project}-dynamodb-${config.name}-write-policy`,
                {
                    policyType: "TargetTrackingScaling",
                    resourceId: writeTarget.resourceId,
                    scalableDimension: writeTarget.scalableDimension,
                    serviceNamespace: writeTarget.serviceNamespace,
                    targetTrackingScalingPolicyConfiguration: {
                        predefinedMetricSpecification: {
                            predefinedMetricType: "DynamoDBWriteCapacityUtilization",
                        },
                        targetValue: config.autoScaling.write.targetValue,
                        ...(config.autoScaling.write.scaleInCooldown && {
                            scaleInCooldown: config.autoScaling.write.scaleInCooldown
                        }),
                        ...(config.autoScaling.write.scaleOutCooldown && {
                            scaleOutCooldown: config.autoScaling.write.scaleOutCooldown
                        })
                    },
                }
            );
            policies.push(writePolicy);
        }

        return policies;
    }

    private configureGsiAutoScaling(
        config: DynamoDbTableConfig,
        table: aws.dynamodb.Table,
        indexName: string,
        autoScaling: { read?: any; write?: any }
    ): pulumi.Resource[] {
        const policies: pulumi.Resource[] = [];
        // Read Auto Scaling for GSI
        if (autoScaling.read?.enabled) {
            const readTarget = new aws.appautoscaling.Target(
                `${this.config.project}-dynamodb-${config.name}-gsi-${indexName}-read-target`,
                {
                    maxCapacity: autoScaling.read.maxCapacity,
                    minCapacity: autoScaling.read.minCapacity,
                    resourceId: pulumi.interpolate`table/${table.name}/index/${indexName}`,
                    scalableDimension: "dynamodb:index:ReadCapacityUnits",
                    serviceNamespace: "dynamodb",
                }
            );

            const readPolicy = new aws.appautoscaling.Policy(
                `${this.config.project}-dynamodb-${config.name}-gsi-${indexName}-read-policy`,
                {
                    policyType: "TargetTrackingScaling",
                    resourceId: readTarget.resourceId,
                    scalableDimension: readTarget.scalableDimension,
                    serviceNamespace: readTarget.serviceNamespace,
                    targetTrackingScalingPolicyConfiguration: {
                        predefinedMetricSpecification: {
                            predefinedMetricType: "DynamoDBReadCapacityUtilization",
                        },
                        targetValue: autoScaling.read.targetValue,
                        ...(autoScaling.read.scaleInCooldown && {
                            scaleInCooldown: autoScaling.read.scaleInCooldown
                        }),
                        ...(autoScaling.read.scaleOutCooldown && {
                            scaleOutCooldown: autoScaling.read.scaleOutCooldown
                        })
                    },
                }
            );
            policies.push(readPolicy);
        }

        // Write Auto Scaling for GSI
        if (autoScaling.write?.enabled) {
            const writeTarget = new aws.appautoscaling.Target(
                `${this.config.project}-dynamodb-${config.name}-gsi-${indexName}-write-target`,
                {
                    maxCapacity: autoScaling.write.maxCapacity,
                    minCapacity: autoScaling.write.minCapacity,
                    resourceId: pulumi.interpolate`table/${table.name}/index/${indexName}`,
                    scalableDimension: "dynamodb:index:WriteCapacityUnits",
                    serviceNamespace: "dynamodb",
                }
            );

            const writePolicy = new aws.appautoscaling.Policy(
                `${this.config.project}-dynamodb-${config.name}-gsi-${indexName}-write-policy`,
                {
                    policyType: "TargetTrackingScaling",
                    resourceId: writeTarget.resourceId,
                    scalableDimension: writeTarget.scalableDimension,
                    serviceNamespace: writeTarget.serviceNamespace,
                    targetTrackingScalingPolicyConfiguration: {
                        predefinedMetricSpecification: {
                            predefinedMetricType: "DynamoDBWriteCapacityUtilization",
                        },
                        targetValue: autoScaling.write.targetValue,
                        ...(autoScaling.write.scaleInCooldown && {
                            scaleInCooldown: autoScaling.write.scaleInCooldown
                        }),
                        ...(autoScaling.write.scaleOutCooldown && {
                            scaleOutCooldown: autoScaling.write.scaleOutCooldown
                        })
                    },
                }
            );
            policies.push(writePolicy);
        }

        return policies;
    }
}

export {DynamoDb}