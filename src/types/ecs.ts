/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";

export type EcsResult = {
    cluster: aws.ecs.Cluster;
    executeRole: aws.iam.Role;
};

export type ALBHealthCheck = {
    healthyThreshold: number;
    interval: number;
    path: string;
    timeout: number;
    unhealthyThreshold: number;
    matcher: string;
    protocol: string;
    port: number;
};

export type ALBConfig = {
    port: number;
    protocol: string;
    targetType: "ip" | "instance";
    healthCheck: ALBHealthCheck;
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
    asgDesiredCount: number;
    asgMinCount: number;
    asgMaxCount: number;
    asgMaxMemory: number;
    asgMaxCpu: number;
    deploymentMinimumHealthyPercent: number;
    deploymentMaximumPercent: number;
    enableExecuteCommand: boolean;
    healthCheckGracePeriodSeconds: number;
    containerHealthCheckUrl: string;
    alb: ALBConfig;
};

export type EcsServiceResult = {
    ecsService: aws.ecs.Service;
    taskRole: aws.iam.Role;
    logGroup: aws.cloudwatch.LogGroup;
};
