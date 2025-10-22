/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export type ElastiCacheConfig = {
    name: string;
    allocatedStorage: number;
    engineVersion: string;
    nodeType: string;
    numNodeGroups: number;
    replicasPerNodeGroup?: number;
    snapshotRetentionLimit: number;
    parameterGroupFamily: string;
    parameterGroupValues: { name: string; value: string; }[];
    port: number;
    automaticFailoverEnabled: boolean;
    multiAzEnabled: boolean;
    applyImmediately?: boolean;
    authToken?: pulumi.Output<string>;
    clusterMode?: boolean;
    domainReader: string;
    domainWriter: string;
};

export type ElastiCacheResult = {
    cluster: aws.elasticache.ReplicationGroup;
    kms: aws.kms.Key;
    securityGroup: aws.ec2.SecurityGroup;
};
