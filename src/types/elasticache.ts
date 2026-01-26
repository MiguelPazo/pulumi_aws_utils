/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {PhzResult} from "./base";
import {VpcImportResult} from "./vpc";

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

export type ElastiCacheModuleConfig = {
    elastiCacheConfig: ElastiCacheConfig;
    vpc: pulumi.Output<VpcImportResult>;
    subnetIds: pulumi.Output<string[]>;
    phz: pulumi.Output<PhzResult>;
    kmsKey?: pulumi.Output<aws.kms.Key | aws.kms.ReplicaKey>;
};

export type ElastiCacheResult = {
    cluster: aws.elasticache.ReplicationGroup;
    kms: aws.kms.Key;
    securityGroup: aws.ec2.SecurityGroup;
};
