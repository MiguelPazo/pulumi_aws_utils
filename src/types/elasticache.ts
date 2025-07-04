/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as awsx from "@pulumi/awsx";

export type ElastiCacheConfig = {
    name: string;
    allocatedStorage: number;
    engineVersion: string;
    nodeType: string;
    numNodeGroups: number;
    replicasPerNodeGroup: number;
    snapshotRetentionLimit: number;
    parameterGroupFamily: string;
    parameterGroupValues: { name: string; value: string; }[];
    port: number;
    automaticFailoverEnabled: boolean;
    domainRdsReader: string;
    domainRdsWriter: string;
};

export type ElastiCacheResult = {
    cluster: aws.elasticache.ReplicationGroup;
    kms: aws.kms.Key;
    securityGroup: pulumi.Output<awsx.classic.ec2.SecurityGroup>;
};
