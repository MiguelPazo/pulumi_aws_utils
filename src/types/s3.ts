/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export type S3Config = {
    name: string;
    kmsKey?: pulumi.Output<aws.kms.Key | aws.kms.ReplicaKey>;
    s3Logs?: pulumi.Output<aws.s3.Bucket>;
    enableCors?: boolean;
    enableReceiveLogs?: boolean;
    enableCloudfrontLogs?: boolean;
    cloudfront?: pulumi.Output<aws.cloudfront.Distribution>;
    fullName?: pulumi.Output<string> | string;
    enableObjectLock?: boolean;
    enableVersioning?: boolean;
    disableAcl?: boolean;
    disablePolicy?: boolean;
    provider?: aws.Provider;
    multiRegion?: boolean;
    failoverReplica?: boolean;
    s3LogsReplica?: pulumi.Output<aws.s3.Bucket>;
    regionReplica?: string;
    providerReplica?: aws.Provider;
    replicationRole?: pulumi.Input<aws.iam.Role>;
    enableDeleteMarkerReplication?: boolean;
    enableRTC?: boolean;
    kmsKeyReplica?: pulumi.Output<aws.kms.Key | aws.kms.ReplicaKey>;
};

export type S3ReplicaConfig = {
    createRole: boolean;
    name?: string;
    sourceKmsArn?: pulumi.Input<string>;
    destKmsArn?: pulumi.Input<string>;
    sourceRegion?: pulumi.Input<string>;
    destRegion?: pulumi.Input<string>;
    s3Source?: pulumi.Input<aws.s3.Bucket>;
    s3Replica?: pulumi.Input<aws.s3.Bucket>;
    replicationRole?: pulumi.Input<aws.iam.Role>;
    replicationConfigName?: string;
    enableDeleteMarkerReplication?: boolean;
    enableRTC?: boolean;
};

export type S3ReplicaResult = {
    role: aws.iam.Role;
    policy?: aws.iam.Policy;
    replicationConfig?: aws.s3.BucketReplicationConfig;
};
