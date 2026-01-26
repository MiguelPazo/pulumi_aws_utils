/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export type ExportFinalBackupModuleConfig = {
    s3: pulumi.Output<aws.s3.Bucket>;
    snsArn: pulumi.Output<string>;
    cwLogsKmsKey: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>;
    retentionMonths?: number;
    sourceBuckets?: string[];
};

export type ExportFinalBackupResult = {
    stateMachine: aws.sfn.StateMachine;
    stateMachineRole: aws.iam.Role;
};
