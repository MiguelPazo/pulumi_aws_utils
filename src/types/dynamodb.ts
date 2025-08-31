/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";

export type DynamoDbAttribute = {
    name: string;
    type: "S" | "N" | "B";
};

export type DynamoDbGlobalSecondaryIndex = {
    name: string;
    hashKey: string;
    rangeKey?: string;
    projectionType: "ALL" | "KEYS_ONLY" | "INCLUDE";
    projectionAttributes?: string[];
    readCapacity?: number;
    writeCapacity?: number;
};

export type DynamoDbLocalSecondaryIndex = {
    name: string;
    rangeKey: string;
    projectionType: "ALL" | "KEYS_ONLY" | "INCLUDE";
    projectionAttributes?: string[];
};

export type DynamoDbTableConfig = {
    name: string;
    hashKey: string;
    rangeKey?: string;
    billingMode: "PROVISIONED" | "PAY_PER_REQUEST";
    readCapacity?: number;
    writeCapacity?: number;
    pointInTimeRecovery?: boolean;
    deleteProtection?: boolean;
    attributes: DynamoDbAttribute[];
    globalSecondaryIndexes?: DynamoDbGlobalSecondaryIndex[];
    localSecondaryIndexes?: DynamoDbLocalSecondaryIndex[];
    streamEnabled?: boolean;
    streamViewType?: "KEYS_ONLY" | "NEW_IMAGE" | "OLD_IMAGE" | "NEW_AND_OLD_IMAGES";
    tags?: Record<string, string>;
};

export type DynamoDbResult = {
    [key: string]: aws.dynamodb.Table;
};