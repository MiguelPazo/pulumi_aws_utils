"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EcsService = void 0;
/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
const aws = require("@pulumi/aws");
const pulumi = require("@pulumi/pulumi");
const config_1 = require("../config");
class EcsService {
    constructor() {
        this.config = (0, config_1.getInit)();
    }
    static getInstance() {
        if (this.__instance == null) {
            this.__instance = new EcsService();
        }
        return this.__instance;
    }
    async main(service, ecsCluster, executionRole, vpc, securityGroups, createLogGroup, targetGroup, enableAsg, containerDefinitions, cmDomain, efs, efsAccessPoint, efsDirectory, provider, ecrImage, envTask) {
        provider = provider == undefined ? "FARGATE" : provider;
        /**
         * Task Role
         */
        const taskRole = new aws.iam.Role(`${this.config.project}-${service.nameShort}-ecs-task-role`, {
            name: `${this.config.generalPrefixShort}-${service.name}-ecs-task-role`,
            assumeRolePolicy: pulumi.output(this.config.accountId).apply(x => {
                return JSON.stringify({
                    "Version": "2012-10-17",
                    "Statement": [
                        {
                            "Effect": "Allow",
                            "Principal": {
                                "Service": "ecs-tasks.amazonaws.com"
                            },
                            "Action": "sts:AssumeRole",
                            "Condition": {
                                "ArnLike": {
                                    "aws:SourceArn": `arn:aws:ecs:${aws.config.region}:${x}:*`
                                }
                            }
                        }
                    ]
                });
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefixShort}-${service.name}-ecs-task-role`,
            }
        });
        /**
         * LogGroup
         */
        let logGroup;
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
        /**
         * Task Definition
         */
        const task = new aws.ecs.TaskDefinition(`${this.config.project}-${service.nameShort}-ecs-task`, {
            family: `${this.config.generalPrefix}-${service.name}-family`,
            cpu: service.cpu.toString(),
            memory: service.memory.toString(),
            requiresCompatibilities: [provider],
            networkMode: "awsvpc",
            executionRoleArn: executionRole.arn,
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
                                protocol: "tcp"
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
                        healthCheck: service.containerHealthCheckUrl ? {
                            retries: service.alb.healthCheck.unhealthyThreshold,
                            timeout: service.alb.healthCheck.timeout,
                            interval: service.alb.healthCheck.interval,
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
                ]);
            })
        }, { dependsOn: [logGroup] });
        /**
         * ECS Service
         */
        const ecsService = new aws.ecs.Service(`${this.config.project}-${service.nameShort}-ecs-serv`, {
            name: `${this.config.generalPrefix}-${service.name}`,
            cluster: ecsCluster.id,
            taskDefinition: task.arn,
            desiredCount: service.asgDesiredCount,
            deploymentMinimumHealthyPercent: service.deploymentMinimumHealthyPercent,
            deploymentMaximumPercent: service.deploymentMaximumPercent,
            enableExecuteCommand: service.enableExecuteCommand,
            healthCheckGracePeriodSeconds: targetGroup ? service.healthCheckGracePeriodSeconds : null,
            // healthCheckGracePeriodSeconds: targetGroup ? service.healthCheckGracePeriodSeconds : undefined,
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
            loadBalancers: targetGroup ? [
                {
                    targetGroupArn: targetGroup.arn,
                    containerName: `${this.config.generalPrefix}-${service.name}`,
                    containerPort: service.port
                }
            ] : [],
            serviceRegistries: cmDomain ? {
                registryArn: cmDomain.arn,
                port: service.port
            } : null
        }, {
            dependsOn: [task],
            ignoreChanges: ['desiredCount', 'taskDefinition']
        });
        /**
         * ASG
         */
        if (enableAsg) {
            const asgTarget = new aws.appautoscaling.Target(`${this.config.project}-${service.nameShort}-ecs-asg-tg`, {
                maxCapacity: service.asgMaxCount,
                minCapacity: service.asgMinCount,
                resourceId: pulumi.interpolate `service/${ecsCluster.name}/${ecsService.name}`,
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
        return {
            ecsService,
            taskRole,
            logGroup
        };
    }
}
exports.EcsService = EcsService;
//# sourceMappingURL=EcsService.js.map