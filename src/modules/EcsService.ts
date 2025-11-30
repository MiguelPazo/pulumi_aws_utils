/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {EcsServiceConfig, EcsServiceResult, VpcImportResult} from "../types";
import {InitConfig} from "../types/module";
import {getInit} from "../config";

class EcsService {
    private static __instance: EcsService;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): EcsService {
        if (this.__instance == null) {
            this.__instance = new EcsService();
        }

        return this.__instance;
    }

    async main(
        service: EcsServiceConfig,
        ecsCluster: pulumi.Output<aws.ecs.Cluster>,
        vpc: pulumi.Output<VpcImportResult>,
        securityGroups: aws.ec2.SecurityGroup[],
        createLogGroup: boolean,
        targetGroups?: pulumi.Output<aws.lb.TargetGroup>[],
        containerDefinitions?: any,
        cmDomain?: aws.servicediscovery.Service,
        efs?: pulumi.Output<aws.efs.FileSystem>,
        efsAccessPoint?: pulumi.Output<aws.efs.AccessPoint>,
        efsDirectory?: string,
        provider?: string,
        ecrImage?: pulumi.Output<string>,
        envTask?: { name: string; value: string }[],
        createService?: boolean,
    ): Promise<EcsServiceResult> {
        provider = provider == undefined ? "FARGATE" : provider;
        createService = createService == undefined ? true : createService;

        /**
         * Task Execute Role
         */
        const taskExecRole = new aws.iam.Role(`${this.config.project}-${service.nameShort}-ecs-task-exec-role`, {
            name: `${this.config.generalPrefixShort}-${service.name}-ecs-task-exec-role`,
            assumeRolePolicy: {
                Version: "2012-10-17",
                Statement: [
                    {
                        Effect: "Allow",
                        Principal: {
                            Service: "ecs-tasks.amazonaws.com"
                        },
                        Action: "sts:AssumeRole"
                    }
                ]
            },
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefixShort}-task-execute-role`,
            }
        });

        /**
         * Task Role
         */
        const taskRole = new aws.iam.Role(`${this.config.project}-${service.nameShort}-ecs-task-role`, {
            name: `${this.config.generalPrefixShort}-${service.name}-ecs-task-role`,
            assumeRolePolicy: pulumi.output(this.config.accountId).apply(x => {
                return JSON.stringify({
                    Version: "2012-10-17",
                    Statement: [
                        {
                            Effect: "Allow",
                            Principal: {
                                Service: "ecs-tasks.amazonaws.com"
                            },
                            Action: "sts:AssumeRole",
                            Condition: {
                                ArnLike: {
                                    "aws:SourceArn": `arn:aws:ecs:${aws.config.region}:${x}:*`
                                }
                            }
                        }
                    ]
                })
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefixShort}-${service.name}-ecs-task-role`,
            }
        });

        /**
         * LogGroup
         */
        let logGroup: aws.cloudwatch.LogGroup;
        let logGroupServiceConnect: aws.cloudwatch.LogGroup;

        if (createLogGroup) {
            logGroup = new aws.cloudwatch.LogGroup(`${this.config.project}-${service.nameShort}-ecs-task-loggroup`, {
                name: `/aws/ecs/task/${this.config.generalPrefix}-${service.name}`,
                retentionInDays: this.config.cloudwatchRetentionLogs,
                tags: {
                    ...this.config.generalTags,
                    Name: `/aws/ecs/task/${this.config.generalPrefix}-${service.name}`
                }
            });
        }

        if (createLogGroup && service.serviceConnect?.enabled) {
            logGroupServiceConnect = new aws.cloudwatch.LogGroup(`${this.config.project}-${service.nameShort}-ecs-sc-loggroup`, {
                name: `/aws/ecs/service-connect/${this.config.generalPrefix}-${service.name}`,
                retentionInDays: this.config.cloudwatchRetentionLogs,
                tags: {
                    ...this.config.generalTags,
                    Name: `/aws/ecs/service-connect/${this.config.generalPrefix}-${service.name}`
                }
            });
        }

        /**
         * Task Definition
         */
        const task = new aws.ecs.TaskDefinition(`${this.config.project}-${service.nameShort}-ecs-task`, {
            family: `${this.config.generalPrefix}-${service.name}-family`,
            cpu: service.cpu.toString(),
            memory: service.memory.toString(),
            requiresCompatibilities: [provider],
            networkMode: "awsvpc",
            executionRoleArn: taskExecRole.arn,
            taskRoleArn: taskRole.arn,
            ephemeralStorage: {
                sizeInGib: service.storage
            },
            runtimePlatform: {
                operatingSystemFamily: "LINUX",
                cpuArchitecture: "X86_64"
            },
            volumes: efs ? [{
                name: "efs",
                efsVolumeConfiguration: {
                    fileSystemId: efs.id,
                    transitEncryption: 'ENABLED',
                    authorizationConfig: {
                        accessPointId: efsAccessPoint.id,
                        iam: 'ENABLED',
                    }
                }
            }] : [],
            containerDefinitions: containerDefinitions || pulumi.all([logGroup.name, ecrImage]).apply(x => {
                return JSON.stringify([
                    {
                        name: `${this.config.generalPrefix}-${service.name}`,
                        image: ecrImage ? x[1] : service.image,
                        cpu: service.cpu,
                        memory: service.memory,
                        portMappings: [
                            {
                                containerPort: service.port,
                                hostPort: service.port,
                                protocol: "tcp",
                                name: service.serviceConnect?.enabled ? service.serviceConnect.serviceName : undefined,
                                appProtocol: service.serviceConnect?.enabled ? "http" : undefined
                            }
                        ],
                        essential: true,
                        environment: envTask || [],
                        environmentFiles: [],
                        mountPoints: efs ? [{
                            sourceVolume: "efs",
                            containerPath: efsDirectory,
                            readOnly: false
                        }] : [],
                        volumesFrom: [],
                        logConfiguration: {
                            logDriver: "awslogs",
                            options: {
                                "awslogs-group": x[0].toString(),
                                "awslogs-region": aws.config.region,
                                "awslogs-stream-prefix": "ecs",
                                "awslogs-multiline-pattern": "\\d{2}:\\d{2}:\\d{2}\\.\\d{3}"
                            }
                        },
                        healthCheck: (service.containerHealthCheckUrl && service.alb != undefined) ? {
                            retries: service.alb.tgHealthCheck.unhealthyThreshold,
                            timeout: service.alb.tgHealthCheck.timeout,
                            interval: service.alb.tgHealthCheck.interval,
                            startPeriod: service.healthCheckGracePeriodSeconds,
                            command: [
                                "CMD-SHELL",
                                `curl -f ${service.containerHealthCheckUrl} || exit 1`
                            ]
                        } : null,
                        volumes: [],
                        placementConstraints: [],
                        requiresCompatibilities: [provider],
                        runtimePlatform: {
                            cpuArchitecture: "X86_64",
                            operatingSystemFamily: "LINUX"
                        },
                        linuxParameters: {
                            initProcessEnabled: true
                        }
                    }
                ])
            })
        }, {
            dependsOn: [logGroup],
            ignoreChanges: [
                "cpu",
                "memory",
                "containerDefinitions"
            ]
        });

        /**
         * ECS Service
         */
        let ecsService: aws.ecs.Service;

        if (createService) {
            ecsService = new aws.ecs.Service(`${this.config.project}-${service.nameShort}-ecs-serv`, {
                    name: `${this.config.generalPrefix}-${service.name}`,
                    cluster: ecsCluster.id,
                    taskDefinition: task.arn,
                    desiredCount: service.asgDesiredCount,
                    deploymentMinimumHealthyPercent: service.deploymentMinimumHealthyPercent,
                    deploymentMaximumPercent: service.deploymentMaximumPercent,
                    enableExecuteCommand: service.enableExecuteCommand,
                    healthCheckGracePeriodSeconds: targetGroups && targetGroups.length > 0 ? service.healthCheckGracePeriodSeconds : undefined,
                    propagateTags: "SERVICE",
                    availabilityZoneRebalancing: "ENABLED",
                    deploymentCircuitBreaker: {
                        enable: true,
                        rollback: true
                    },
                    capacityProviderStrategies: [
                        {
                            base: 1,
                            capacityProvider: provider,
                            weight: 100
                        }
                    ],
                    deploymentController: {
                        type: "ECS"
                    },
                    networkConfiguration: {
                        subnets: vpc.privateSubnetIds,
                        securityGroups: pulumi.all(securityGroups.map(sg => sg.id)),
                        assignPublicIp: false
                    },
                    loadBalancers: targetGroups && targetGroups.length > 0 ? targetGroups.map(tg => ({
                        targetGroupArn: tg.arn,
                        containerName: `${this.config.generalPrefix}-${service.name}`,
                        containerPort: service.port
                    })) : [],
                    serviceRegistries: cmDomain ? {
                        registryArn: cmDomain.arn,
                        port: service.port
                    } : null,
                    serviceConnectConfiguration: service.serviceConnect?.enabled ? {
                        enabled: true,
                        namespace: service.serviceConnect.namespace,
                        logConfiguration: {
                            logDriver: "awslogs",
                            options: {
                                "awslogs-group": logGroupServiceConnect.name,
                                "awslogs-region": aws.config.region,
                                "awslogs-stream-prefix": "service-connect"
                            }
                        },
                        services: [{
                            portName: service.serviceConnect.serviceName,
                            discoveryName: service.serviceConnect.serviceName,
                            clientAlias: [{
                                port: service.serviceConnect.port || service.port,
                                dnsName: service.serviceConnect.dnsName || service.name
                            }],
                            ingressPortOverride: service.serviceConnect.ingressPortOverride
                        }]
                    } : undefined
                }, {
                    dependsOn: [task],
                    ignoreChanges: ['desiredCount', 'taskDefinition']
                }
            );

            /**
             * ASG
             */
            if (service.asgEnabled) {
                const asgTarget = new aws.appautoscaling.Target(`${this.config.project}-${service.nameShort}-ecs-asg-tg`, {
                    maxCapacity: service.asgMaxCount,
                    minCapacity: service.asgMinCount,
                    resourceId: pulumi.interpolate`service/${ecsCluster.name}/${ecsService.name}`,
                    scalableDimension: "ecs:service:DesiredCount",
                    serviceNamespace: "ecs",
                });

                new aws.appautoscaling.Policy(`${this.config.project}-${service.nameShort}-ecs-asg-memory`, {
                    policyType: "TargetTrackingScaling",
                    resourceId: asgTarget.resourceId,
                    scalableDimension: asgTarget.scalableDimension,
                    serviceNamespace: asgTarget.serviceNamespace,
                    targetTrackingScalingPolicyConfiguration: {
                        predefinedMetricSpecification: {
                            predefinedMetricType: "ECSServiceAverageMemoryUtilization",
                        },
                        targetValue: service.asgMaxMemory
                    },
                });

                new aws.appautoscaling.Policy(`${this.config.project}-${service.nameShort}-ecs-asg-cpu`, {
                    policyType: "TargetTrackingScaling",
                    resourceId: asgTarget.resourceId,
                    scalableDimension: asgTarget.scalableDimension,
                    serviceNamespace: asgTarget.serviceNamespace,
                    targetTrackingScalingPolicyConfiguration: {
                        predefinedMetricSpecification: {
                            predefinedMetricType: "ECSServiceAverageCPUUtilization",
                        },
                        targetValue: service.asgMaxCpu
                    },
                });
            }
        }

        return {
            ecsService,
            task,
            taskExecRole,
            taskRole,
            logGroup
        } as EcsServiceResult;
    }
}

export {EcsService}
