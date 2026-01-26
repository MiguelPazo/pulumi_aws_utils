/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {LBConfig} from "./alb";
import {VpcImportResult} from "./vpc";
import {CloudWatchDataProtectionResult} from "./cloudwatch";

export type ServiceConnectConfig = {
    enabled: boolean;
    namespace: pulumi.Output<string>;
    serviceName: string;
    port?: number;
    dnsName?: string;
    ingressPortOverride?: number;
};

export type EcsServiceConfig = {
    name: string;
    nameShort: string;
    dnsInternal?: string;
    dnsExternal?: string;
    image: string;
    policyName: string;
    port: number;
    cpu: number;
    memory: number;
    storage: number;
    asgEnabled: boolean;
    asgDesiredCount?: number;
    asgMinCount?: pulumi.Output<number> | number;
    asgMaxCount?: pulumi.Output<number> | number;
    asgMaxMemory?: pulumi.Output<number> | number;
    asgMaxCpu?: number;
    deploymentMinimumHealthyPercent: number;
    deploymentMaximumPercent: number;
    enableExecuteCommand: boolean;
    healthCheckGracePeriodSeconds?: number;
    containerHealthCheckUrl?: string;
    nlb?: LBConfig;
    alb?: LBConfig;
    serviceConnect?: ServiceConnectConfig;
};

export type EcsClusterModuleConfig = {
    logGroupKmsKey: pulumi.Output<aws.kms.Key>;
    clusterName?: string;
    provider?: string;
};

export type EcsServiceModuleConfig = {
    service: EcsServiceConfig;
    ecsCluster: pulumi.Output<aws.ecs.Cluster>;
    vpc: pulumi.Output<VpcImportResult>;
    securityGroups: aws.ec2.SecurityGroup[];
    createLogGroup: boolean;
    logGroupKmsKey: pulumi.Output<aws.kms.Key | aws.kms.ReplicaKey>;
    targetGroups?: pulumi.Output<aws.lb.TargetGroup>[];
    containerDefinitions?: any;
    cmDomain?: aws.servicediscovery.Service;
    efs?: pulumi.Output<aws.efs.FileSystem>;
    efsAccessPoint?: pulumi.Output<aws.efs.AccessPoint>;
    efsDirectory?: string;
    provider?: string;
    ecrImage?: pulumi.Output<string>;
    envTask?: { name: string; value: string }[];
    createService?: boolean;
    cwConfig?: pulumi.Output<CloudWatchDataProtectionResult>;
};

export type EcsServiceResult = {
    ecsService: aws.ecs.Service;
    task: aws.ecs.TaskDefinition;
    taskExecRole: aws.iam.Role;
    taskRole: aws.iam.Role;
    logGroup: aws.cloudwatch.LogGroup;
};
