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
            const tableKey = `table${tableName.charAt(0).toUpperCase() + tableName.slice(1).replace(/_([a-z])/g, (match, letter) => letter.toUpperCase())}`;

            // Create DynamoDB table
            tables[tableKey] = new aws.dynamodb.Table(`${this.config.project}-dynamodb-${config.name}`, {
                name: `${this.config.generalPrefix}-table-${config.name}`,
                attributes: config.attributes,
                hashKey: config.hashKey,
                ...(config.rangeKey && {rangeKey: config.rangeKey}),
                billingMode: config.billingMode,
                ...(config.billingMode === "PROVISIONED" && {
                    readCapacity: config.readCapacity || 5,
                    writeCapacity: config.writeCapacity || 5
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
                tags: {
                    ...this.config.generalTags,
                    Name: `${this.config.generalPrefix}-table-${config.name}`,
                    ...config.tags
                }
            });
        });

        return tables as DynamoDbResult;
    }
}

export {DynamoDb}