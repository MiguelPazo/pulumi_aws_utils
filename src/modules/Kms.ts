/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import {InitConfig} from "../types/module";
import type {KmsModuleConfig, KmsKeyResult} from "../types";
import {getInit} from "../config";

class Kms {
    private static __instance: Kms;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): Kms {
        if (this.__instance == null) {
            this.__instance = new Kms();
        }

        return this.__instance;
    }

    async main(config: KmsModuleConfig): Promise<KmsKeyResult> {
        const {
            name,
            keyConfig,
            createAlias = true,
            additionalStatements,
            provider,
            providersReplicas
        } = config;

        const isMultiRegion = keyConfig?.multiRegion || false;

        // Validate that providersReplicas is provided when multiRegion is true
        if (isMultiRegion && (!providersReplicas || providersReplicas.length === 0)) {
            throw new Error("providersReplicas array is required when multiRegion is true");
        }

        const keyName = `${this.config.project}-${name}-kms-key`;
        const keyDescription = keyConfig?.description || `KMS key for ${name}`;

        const key = new aws.kms.Key(keyName, {
            description: keyDescription,
            keyUsage: keyConfig?.keyUsage || "ENCRYPT_DECRYPT",
            customerMasterKeySpec: keyConfig?.keySpec || "SYMMETRIC_DEFAULT",
            multiRegion: isMultiRegion,
            deletionWindowInDays: keyConfig?.deletionWindowInDays || 7,
            enableKeyRotation: keyConfig?.enableKeyRotation || true,
            policy: keyConfig?.policy || pulumi.output(this.config.accountId).apply(x => {
                const baseStatements = [
                    {
                        Sid: "EnableRootPermissions",
                        Effect: "Allow",
                        Principal: {
                            AWS: `arn:aws:iam::${x}:root`,
                        },
                        Action: "kms:*",
                        Resource: "*",
                    }
                ];

                if (additionalStatements) {
                    baseStatements.push(...additionalStatements);
                }

                return JSON.stringify({
                    Version: "2012-10-17",
                    Statement: baseStatements
                })
            }),
            tags: {
                ...this.config.generalTags,
                Name: keyName,
                ...keyConfig?.tags
            }
        }, provider ? {provider} : undefined);

        let alias: aws.kms.Alias | undefined;

        if (createAlias) {
            alias = new aws.kms.Alias(`${this.config.project}-${name}-kms-alias`, {
                name: `alias/${this.config.generalPrefix}-${name}-kms`,
                targetKeyId: key.keyId,
            }, provider ? {provider} : undefined);
        }

        // Create replicas in other regions if multiRegion is enabled
        let replicas: aws.kms.ReplicaKey[] | undefined;
        let replicaAliases: aws.kms.Alias[] | undefined;

        if (isMultiRegion && providersReplicas && createAlias) {
            replicas = [];
            replicaAliases = [];

            for (let index = 0; index < providersReplicas.length; index++) {
                const replicaProvider = providersReplicas[index];

                // Get region from provider
                const regionData = await aws.getRegion({}, {provider: replicaProvider});
                const region = regionData.name;

                // Create replica key
                const replicaKey = new aws.kms.ReplicaKey(`${this.config.project}-${name}-kms-replica-${index}`, {
                    description: keyDescription,
                    primaryKeyArn: key.arn,
                    deletionWindowInDays: keyConfig?.deletionWindowInDays || 7,
                    tags: {
                        ...this.config.generalTags,
                        Name: `${keyName}-replica-${region}`,
                        ...keyConfig?.tags
                    }
                }, {provider: replicaProvider});

                replicas.push(replicaKey);

                // Create alias for replica
                const replicaAlias = new aws.kms.Alias(`${this.config.project}-${name}-kms-alias-replica-${index}`, {
                    name: `alias/${this.config.generalPrefix}-${name}-kms-replica-${region}`,
                    targetKeyId: replicaKey.keyId,
                }, {provider: replicaProvider});

                replicaAliases.push(replicaAlias);
            }
        } else if (isMultiRegion && providersReplicas) {
            replicas = [];

            for (let index = 0; index < providersReplicas.length; index++) {
                const replicaProvider = providersReplicas[index];

                // Get region from provider
                const regionData = await aws.getRegion({}, {provider: replicaProvider});
                const region = regionData.name;

                // Create replica key
                const replicaKey = new aws.kms.ReplicaKey(`${this.config.project}-${name}-kms-replica-${index}`, {
                    description: keyDescription,
                    primaryKeyArn: key.arn,
                    deletionWindowInDays: keyConfig?.deletionWindowInDays || 7,
                    tags: {
                        ...this.config.generalTags,
                        Name: `${keyName}-replica-${region}`,
                        ...keyConfig?.tags
                    }
                }, {provider: replicaProvider});

                replicas.push(replicaKey);
            }
        }

        return {
            key,
            alias,
            replicas,
            replicaAliases
        } as KmsKeyResult
    }

    async updateKeyPolicy(
        keyId: string | pulumi.Output<string>,
        policyName: string,
        newPolicy: string | pulumi.Output<string>
    ): Promise<aws.kms.KeyPolicy> {
        return new aws.kms.KeyPolicy(`${this.config.project}-kms-policy-${policyName}`, {
            keyId: keyId,
            policy: newPolicy
        });
    }
}

export {Kms}