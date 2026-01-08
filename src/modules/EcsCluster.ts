/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import {InitConfig} from "../types/module";
import {EcsClusterModuleConfig} from "../types";
import {getInit} from "../config";
import * as pulumi from "@pulumi/pulumi";

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

    async main(config: EcsClusterModuleConfig): Promise<aws.ecs.Cluster> {
        const {logGroupKmsKey, clusterName, provider = "FARGATE"} = config;

        const generalPrefixObj = clusterName ? `${this.config.project}-${clusterName}` : this.config.project;
        const generalPrefix = clusterName ? `${this.config.generalPrefix}-${clusterName}` : this.config.generalPrefix;

        /**
         * LogGroup
         */
        const logGroup = new aws.cloudwatch.LogGroup(`${generalPrefixObj}-ecs-loggroup`, {
            name: `/aws/ecs/cluster/${generalPrefix}`,
            retentionInDays: this.config.cloudwatchRetentionLogs,
            kmsKeyId: logGroupKmsKey.arn,
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

        return cluster;
    }
}

export {EcsCluster}
