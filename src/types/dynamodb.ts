/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

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

export type DynamoDbAutoScalingConfig = {
    enabled: boolean;
    minCapacity: number;
    maxCapacity: number;
    targetValue: number;
    scaleInCooldown?: number;
    scaleOutCooldown?: number;
};

export type DynamoDbAutoScaling = {
    read?: DynamoDbAutoScalingConfig;
    write?: DynamoDbAutoScalingConfig;
};

export type DynamoDbGsiAutoScaling = {
    [indexName: string]: DynamoDbAutoScaling;
};

export type DynamoDbReplicaConfig = {
    pointInTimeRecovery?: boolean;
    propagateTags?: boolean;
    deletionProtectionEnabled?: boolean;
    kmsKey?: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>;
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
    autoScaling?: DynamoDbAutoScaling;
    gsiAutoScaling?: DynamoDbGsiAutoScaling;
    applyAutoScalingToAllGsi?: boolean;
};

export type DynamoDbResult = {
    [key: string]: aws.dynamodb.Table;
};

export type DynamoDbModuleConfig = {
    tableConfigs: DynamoDbTableConfig[];
    kmsKey?: pulumi.Output<aws.kms.Key>;
    replicaRegion?: string;
    replicaConfig?: DynamoDbReplicaConfig;
    tablePrefix?: string;
    // Set to true to skip replica creation in first deployment phase
    // Required when using PROVISIONED + Auto Scaling + Global Tables
    skipReplicaCreation?: boolean;
};