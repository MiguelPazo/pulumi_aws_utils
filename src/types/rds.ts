/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import {PhzResult} from "./base";
import {VpcImportResult} from "./vpc";

export type RdsConfig = {
    name: string;
    allocatedStorage: number;
    engine: string;
    engineVersion: string;
    instanceClass: string;
    port: number;
    username: pulumi.Output<string> | string;
    password: pulumi.Output<string> | string;
    parameterGroupFamily: string;
    parameterGroupValues: { name: string; value: string; }[];
    skipFinalSnapshot: boolean;
    domainRdsReader: string;
    domainRdsWriter: string;
    publiclyAccessible?: boolean;
    applyImmediately?: boolean;
    domainPublicRdsReader?: pulumi.Output<string> | string;
    domainPublicRdsWriter?: pulumi.Output<string> | string;
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
    username: pulumi.Output<string> | string;
    password: pulumi.Output<string> | string;
    parameterGroupFamily: string;
    parameterGroupValues?: { name: string; value: string; }[];
    clusterParameterGroupValues?: { name: string; value: string; }[];
    skipFinalSnapshot: boolean;
    backupRetentionPeriod?: number;
    preferredBackupWindow?: string;
    preferredMaintenanceWindow?: string;
    domainRdsReader: string;
    domainRdsWriter: string;
    domainPublicRdsReader?: pulumi.Output<string> | string;
    domainPublicRdsWriter?: pulumi.Output<string> | string;
    enableCloudwatchLogsExports?: string[];
    enablePerformanceInsights?: boolean;
    publiclyAccessible?: boolean;
    applyImmediately?: boolean;
};

export type RdsAuroraResult = {
    cluster: aws.rds.Cluster;
    instances: aws.rds.ClusterInstance[];
    kms: aws.kms.Key;
    securityGroup: aws.ec2.SecurityGroup;
    clusterParameterGroup?: aws.rds.ClusterParameterGroup;
    parameterGroup?: aws.rds.ParameterGroup;
};

export type RdsProxyAuth = {
    authScheme?: "SECRETS";
    iamAuth?: "DISABLED" | "REQUIRED";
    secretArn: pulumi.Output<string> | string;
    clientPasswordAuthType?: "MYSQL_CACHING_SHA2_PASSWORD" | "MYSQL_NATIVE_PASSWORD" | "POSTGRES_SCRAM_SHA_256" | "POSTGRES_MD5" | "SQL_SERVER_AUTHENTICATION";
};

export type RdsProxyConfig = {
    name: string;
    engineFamily: "MYSQL" | "POSTGRESQL" | "SQLSERVER";
    auths: RdsProxyAuth[];
    requireTls?: boolean;
    debugLogging?: boolean;
    idleClientTimeout?: number;
    connectionBorrowTimeout?: number;
    maxConnectionsPercent?: number;
    maxIdleConnectionsPercent?: number;
    domainRdsProxy?: string;
    domainPublicRdsProxy?: string;
};

export type RdsProxyResult = {
    proxy: aws.rds.Proxy;
    defaultTargetGroup: aws.rds.ProxyDefaultTargetGroup;
    target: aws.rds.ProxyTarget;
    securityGroup: aws.ec2.SecurityGroup;
    iamRole: aws.iam.Role;
    secretsPolicy: aws.iam.RolePolicy;
};

export type RdsModuleConfig = {
    rdsConfig: RdsConfig;
    vpc: pulumi.Output<VpcImportResult>;
    subnetIds: pulumi.Output<string[]>;
    kmsKey?: pulumi.Output<aws.kms.Key>;
    phz?: pulumi.Output<PhzResult>;
    publicZoneRoodId?: pulumi.Output<string>;
};

export type RdsAuroraModuleConfig = {
    auroraConfig: RdsAuroraConfig;
    vpc: pulumi.Output<VpcImportResult>;
    subnetIds: pulumi.Output<string[]>;
    phz: pulumi.Output<PhzResult>;
    kmsKey?: pulumi.Output<aws.kms.Key>;
    publicZoneRoodId?: pulumi.Output<string>;
};

export type RdsProxyModuleConfig = {
    proxyConfig: RdsProxyConfig;
    vpc: pulumi.Output<VpcImportResult>;
    subnetIds: pulumi.Output<string[]>;
    targetClusterIdentifier: pulumi.Output<string>;
    iamRole: pulumi.Output<aws.iam.Role> | aws.iam.Role;
    phz?: pulumi.Output<PhzResult>;
    publicZoneRootId?: pulumi.Output<string>;
};
