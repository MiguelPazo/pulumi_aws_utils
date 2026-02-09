/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export type ExportFinalBackupModuleConfig = {
    s3: pulumi.Output<aws.s3.Bucket>;
    snsArn: pulumi.Output<string>;
    cwLogsKmsKey: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>;
    lambdaKmsKey?: pulumi.Input<aws.kms.Key>;
    enableParamsSecure?: boolean;
    ssmKmsKey?: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>;
    retentionMonths?: number;
    sourceBuckets?: string[];
};

export type ExportFinalBackupResult = {
    stateMachine: aws.sfn.StateMachine;
    stateMachineRole: aws.iam.Role;
};

export type FailoverCloudFrontConfig = {
    hostedZoneId: string;
    distributionId: string;
    aliasesToRemove?: string[];
    aliasesToAdd?: string[];
    shouldDisable?: boolean;
    shouldEnable?: boolean;
};

export type FailoverRdsConfig = {
    globalClusterId: string;
    secondaryClusterId: string;
    secondaryClusterRegion: string;
};

export type FailoverEfsConfig = {
    sourceFileSystemId: string;
    destinationFileSystemId: string;
    replicationConfigurationId: string;
    destinationRegion: string;
};

export type FailoverS3Config = {
    bucketName: string;
    region?: string;
};

export type FailoverEcsConfig = {
    clusterName: string;
    serviceName: string;
    region?: string;
};

export type FailoverEventBridgeConfig = {
    ruleName: string;
    region: string;
    shouldDisable: boolean;
    shouldEnable: boolean;
};

export type FailoverConfiguration = {
    cloudFront: FailoverCloudFrontConfig[];
    rds: FailoverRdsConfig;
    efs: FailoverEfsConfig[];
    s3Buckets: FailoverS3Config[];
    ecsServices: FailoverEcsConfig[];
    eventBridgeRules: FailoverEventBridgeConfig[];
    secondaryRegion: string;
};

export type StepFunctionFailoverModuleConfig = {
    parameterStoreConfigPath: string;
    failoverStatusPath: string;
    snsArn: pulumi.Output<string>;
    cwLogsKmsKey: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>;
    lambdaKmsKey?: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>;
    enableParamsSecure?: boolean;
    ssmKmsKey?: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>;
};

export type StepFunctionFailoverResult = {
    stateMachine: aws.sfn.StateMachine;
    stateMachineRole: aws.iam.Role;
    lambdaFunction: aws.lambda.Function;
    lambdaRole: aws.iam.Role;
};
