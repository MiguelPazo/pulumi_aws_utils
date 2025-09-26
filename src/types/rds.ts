/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export type RdsConfig = {
    name: string;
    allocatedStorage: number;
    engine: string;
    engineVersion: string;
    instanceClass: string;
    port: number;
    username: pulumi.Output<string>;
    password: pulumi.Output<string>;
    parameterGroupFamily: string;
    parameterGroupValues: { name: string; value: string; }[];
    skipFinalSnapshot: boolean;
    publiclyAccessible: boolean;
    domainRdsReader?: string;
    domainRdsWriter?: string;
};

export type RdsResult = {
    instance: aws.rds.Instance;
    kms: aws.kms.Key;
    securityGroup: aws.ec2.SecurityGroup;
};

export type RdsAuroraConfig = {
    name: string;
    engine: string;
    engineVersion: string;
    instanceClass: string;
    instanceCount: number;
    port: number;
    databaseName: string;
    username: pulumi.Output<string>;
    password: pulumi.Output<string>;
    parameterGroupFamily: string;
    parameterGroupValues?: { name: string; value: string; }[];
    clusterParameterGroupValues?: { name: string; value: string; }[];
    skipFinalSnapshot: boolean;
    backupRetentionPeriod?: number;
    preferredBackupWindow?: string;
    preferredMaintenanceWindow?: string;
    domainRdsReader: string;
    domainRdsWriter: string;
    domainPublicRdsReader?: string;
    domainPublicRdsWriter?: string;
    enableCloudwatchLogsExports?: string[];
    enablePerformanceInsights?: boolean;
    publiclyAccessible?: boolean;
};

export type RdsAuroraResult = {
    cluster: aws.rds.Cluster;
    instances: aws.rds.ClusterInstance[];
    kms: aws.kms.Key;
    securityGroup: aws.ec2.SecurityGroup;
    clusterParameterGroup?: aws.rds.ClusterParameterGroup;
    parameterGroup?: aws.rds.ParameterGroup;
};
