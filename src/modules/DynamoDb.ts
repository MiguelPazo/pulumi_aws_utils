/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import {getInit} from "../config";
import {InitConfig} from "../types/module";
import {DynamoDbResult, DynamoDbTableConfig} from "../types";
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

    async main(
        tableConfigs: DynamoDbTableConfig[],
        kmsKey?: pulumi.Output<aws.kms.Key>,
    ): Promise<DynamoDbResult> {
        const tables: { [key: string]: aws.dynamodb.Table } = {};

        tableConfigs.forEach(config => {
            // Convert table name to camelCase for object key
            const tableName = config.name.replace(/-/g, '_');
            const tableKey = `${tableName.replace(/_([a-z])/g, (match, letter) => letter.toUpperCase())}`;

            // Create DynamoDB table
            const table = new aws.dynamodb.Table(`${this.config.project}-dynamodb-${config.name}`, {
                name: `${this.config.generalPrefix}-table-${config.name}`,
                attributes: config.attributes,
                hashKey: config.hashKey,
                ...(config.rangeKey && {rangeKey: config.rangeKey}),
                billingMode: config.billingMode,
                ...(config.billingMode === "PROVISIONED" && {
                    readCapacity: config.readCapacity,
                    writeCapacity: config.writeCapacity
                }),
                ...(config.globalSecondaryIndexes && {
                    globalSecondaryIndexes: config.globalSecondaryIndexes.map(gsi => ({
                        name: gsi.name,
                        hashKey: gsi.hashKey,
                        ...(gsi.rangeKey && {rangeKey: gsi.rangeKey}),
                        projectionType: gsi.projectionType,
                        ...(gsi.projectionAttributes && {projectionAttributes: gsi.projectionAttributes}),
                        ...(config.billingMode === "PROVISIONED" && {
                            readCapacity: gsi.readCapacity || config.readCapacity || 5,
                            writeCapacity: gsi.writeCapacity || config.writeCapacity || 5
                        })
                    }))
                }),
                ...(config.localSecondaryIndexes && {
                    localSecondaryIndexes: config.localSecondaryIndexes
                }),
                ...(config.streamEnabled && {
                    streamEnabled: config.streamEnabled,
                    streamViewType: config.streamViewType || "NEW_AND_OLD_IMAGES"
                }),
                serverSideEncryption: {
                    enabled: true,
                    ...(kmsKey && {kmsKeyArn: kmsKey.arn})
                },
                pointInTimeRecovery: {
                    enabled: config.pointInTimeRecovery || false
                },
                deletionProtectionEnabled: config.deleteProtection || false,
                tags: {
                    ...this.config.generalTags,
                    Name: `${this.config.generalPrefix}-table-${config.name}`,
                    ...config.tags
                }
            });

            tables[tableKey] = table;

            // Configure Auto Scaling for table if enabled and billingMode is PROVISIONED
            if (config.billingMode === "PROVISIONED" && config.autoScaling) {
                this.configureTableAutoScaling(config, table);
            }

            // Configure Auto Scaling for GSI if enabled
            if (config.billingMode === "PROVISIONED" && config.globalSecondaryIndexes) {
                config.globalSecondaryIndexes.forEach(gsi => {
                    // Apply table auto scaling to all GSI if flag is enabled
                    if (config.applyAutoScalingToAllGsi && config.autoScaling) {
                        this.configureGsiAutoScaling(config, table, gsi.name, config.autoScaling);
                    }
                    // Apply specific GSI auto scaling configuration
                    else if (config.gsiAutoScaling && config.gsiAutoScaling[gsi.name]) {
                        this.configureGsiAutoScaling(config, table, gsi.name, config.gsiAutoScaling[gsi.name]);
                    }
                });
            }
        });

        return tables as DynamoDbResult;
    }

    private configureTableAutoScaling(config: DynamoDbTableConfig, table: aws.dynamodb.Table): void {
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

            new aws.appautoscaling.Policy(
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

            new aws.appautoscaling.Policy(
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
        }
    }

    private configureGsiAutoScaling(
        config: DynamoDbTableConfig,
        table: aws.dynamodb.Table,
        indexName: string,
        autoScaling: { read?: any; write?: any }
    ): void {
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

            new aws.appautoscaling.Policy(
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

            new aws.appautoscaling.Policy(
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
        }
    }
}

export {DynamoDb}