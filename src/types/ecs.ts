/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import {LBConfig} from "./alb";

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
    asgDesiredCount: number;
    asgMinCount?: number;
    asgMaxCount?: number;
    asgMaxMemory?: number;
    asgMaxCpu?: number;
    deploymentMinimumHealthyPercent: number;
    deploymentMaximumPercent: number;
    enableExecuteCommand: boolean;
    healthCheckGracePeriodSeconds: number;
    containerHealthCheckUrl: string;
    nlb?: LBConfig;
    alb?: LBConfig;
};

export type EcsServiceResult = {
    ecsService: aws.ecs.Service | any;
    task: aws.ecs.TaskDefinition;
    taskExecRole: aws.iam.Role;
    taskRole: aws.iam.Role;
    logGroup: aws.cloudwatch.LogGroup;
};
