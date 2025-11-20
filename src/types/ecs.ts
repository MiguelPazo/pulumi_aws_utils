/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {LBConfig} from "./alb";

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

export type EcsServiceResult = {
    ecsService: aws.ecs.Service;
    task: aws.ecs.TaskDefinition;
    taskExecRole: aws.iam.Role;
    taskRole: aws.iam.Role;
    logGroup: aws.cloudwatch.LogGroup;
};
