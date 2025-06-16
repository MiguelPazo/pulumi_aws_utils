/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import {EcsResult} from "../types/ecs";
import {InitConfig} from "../types/module";
import {getInit} from "../config";

class EcsCluster {
    private static __instance: EcsCluster;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): EcsCluster {
        if (this.__instance == null) {
            this.__instance = new EcsCluster();
        }

        return this.__instance;
    }

    async main(clusterName?: string, provider?: string): Promise<EcsResult> {
        const generalPrefixObj = clusterName ? `${this.config.project}-${clusterName}` : this.config.project;
        const generalPrefix = clusterName ? `${this.config.generalPrefix}-${clusterName}` : this.config.generalPrefix;
        const generalPrefixShort = clusterName ? `${this.config.generalPrefixShort}-${clusterName}` : this.config.generalPrefixShort;

        provider = provider || "FARGATE";

        /**
         * LogGroup
         */
        const logGroup = new aws.cloudwatch.LogGroup(`${generalPrefixObj}-ecs-loggroup`, {
            name: `/aws/ecs/cluster/${generalPrefix}`,
            retentionInDays: this.config.cloudwatchRetentionLogs,
            tags: {
                ...this.config.generalTags,
                Name: `/aws/ecs/cluster/${generalPrefix}`
            }
        });

        /**
         * Cluster
         */
        const cluster = new aws.ecs.Cluster(`${generalPrefixObj}-ecs-cluster`, {
            name: `${generalPrefix}-ecs-cluster`,
            settings: [
                {
                    name: "containerInsights",
                    value: "enabled"
                }
            ],
            configuration: {
                executeCommandConfiguration: {
                    logging: "OVERRIDE",
                    logConfiguration: {
                        cloudWatchEncryptionEnabled: false,
                        cloudWatchLogGroupName: logGroup.name
                    }
                }
            },
            tags: {
                ...this.config.generalTags,
                Name: `${generalPrefix}-ecs-cluster`,
            }
        });

        new aws.ecs.ClusterCapacityProviders(`${generalPrefixObj}-ecs-cluster-provider`, {
            clusterName: cluster.name,
            capacityProviders: [provider],
            defaultCapacityProviderStrategies: [
                {
                    base: 1,
                    weight: 100,
                    capacityProvider: provider
                }
            ]
        });

        /**
         * Policies
         */
        const executePolicy = new aws.iam.Policy(`${generalPrefixObj}-task-execute-policy`, {
            name: `${generalPrefixShort}-task-execute-policy`,
            path: "/",
            description: "Policy for execute ECS Tasks",
            policy: JSON.stringify({
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Action": [
                            "ecr:GetAuthorizationToken",
                            "ecr:BatchCheckLayerAvailability",
                            "ecr:GetDownloadUrlForLayer",
                            "ecr:BatchGetImage",
                            "logs:CreateLogStream",
                            "logs:CreateLogGroup",
                            "logs:DescribeLogGroups",
                            "logs:DescribeLogStreams",
                            "logs:PutLogEvents"
                        ],
                        "Resource": "*"
                    }
                ]
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${generalPrefixShort}-task-execute-policy`,
            }
        });

        const executeRole = new aws.iam.Role(`${generalPrefixObj}-task-execute-role`, {
            name: `${generalPrefixShort}-task-execute-role`,
            assumeRolePolicy: {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Principal": {
                            "Service": "ecs-tasks.amazonaws.com"
                        },
                        "Action": "sts:AssumeRole"
                    }
                ]
            },
            tags: {
                ...this.config.generalTags,
                Name: `${generalPrefixShort}-task-execute-role`,
            }
        });

        new aws.iam.RolePolicyAttachment(`${generalPrefixObj}-task-execute-attach1`, {
            role: executeRole.name,
            policyArn: executePolicy.arn,
        });

        return {
            cluster,
            executeRole
        } as EcsResult;
    }
}

export {EcsCluster}
