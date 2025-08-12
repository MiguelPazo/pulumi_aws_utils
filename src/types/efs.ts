/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export type EfsAccessPointCreationInfo = {
    ownerGid: number;
    ownerUid: number;
    permissions: string;
};

export type EfsAccessPointPosixUser = {
    gid: number;
    uid: number;
    secondaryGids?: number[];
};

export type EfsAccessPoint = {
    path: string;
    creationInfo?: EfsAccessPointCreationInfo;
    posixUser?: EfsAccessPointPosixUser;
};

export type EfsLifecyclePolicy = {
    transitionToIa?: string;
    transitionToPrimaryStorageClass?: string;
};

export type EfsConfig = {
    name: string;
    performanceMode?: string;
    throughputMode?: string;
    provisionedThroughputInMibps?: number;
    lifecyclePolicy?: EfsLifecyclePolicy;
    accessPoints?: EfsAccessPoint[];
};

export type EfsResult = {
    fileSystem: aws.efs.FileSystem;
    kms: aws.kms.Key;
    securityGroup: aws.ec2.SecurityGroup;
    mountTargets: pulumi.Output<aws.efs.MountTarget[]>;
    accessPoints?: pulumi.Output<aws.efs.AccessPoint[]>;
};