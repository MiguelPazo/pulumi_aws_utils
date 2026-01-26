/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import {InitConfig} from "../types/module";
import type {KmsKeyResult, KmsModuleConfig} from "../types";
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
            enableMultiregion = false
        } = config;

        const multiRegion = (enableMultiregion && this.config.multiRegion) || false;
        const failoverReplica = this.config.failoverReplica || false;
        const regionReplica = this.config.regionReplica;
        const providerReplica = this.config.providerReplica;

        const keyNameResource = `${this.config.project}-${name}-kms-key`;
        const keyName = `${this.config.generalPrefix}-${name}-kms`;
        const keyDescription = keyConfig?.description || `KMS key for ${name}`;

        /**
         * Handle failover replica scenario - get existing replica key using alias
         */
        if (multiRegion && failoverReplica) {
            if (!regionReplica) {
                throw new Error("regionReplica is required when failoverReplica is true");
            }

            const aliasName = `alias/${this.config.generalPrefixMultiregion}-${name}-kms-replica`;

            // Get the alias as a managed resource first
            const replicaAlias = aws.kms.Alias.get(
                `${this.config.project}-${name}-kms-alias-replica`,
                aliasName,
                undefined,
                providerReplica ? {provider: providerReplica} : undefined
            );

            // Get the replica key using the targetKeyId from the alias
            const replicaKey = aws.kms.ReplicaKey.get(
                `${this.config.project}-${name}-kms-replica`,
                replicaAlias.targetKeyId,
                undefined,
                providerReplica ? {provider: providerReplica} : undefined
            );

            return {
                key: replicaKey,
                alias: createAlias ? replicaAlias : undefined,
                replicaAliases: createAlias ? [replicaAlias] : undefined
            };
        }

        /**
         * Validate multi-region requirements
         */
        if (multiRegion) {
            if (!regionReplica) {
                throw new Error("regionReplica is required when multiRegion is true");
            }
            if (!providerReplica) {
                throw new Error("providerReplica is required when multiRegion is true");
            }
        }

        const key = new aws.kms.Key(keyNameResource, {
            description: keyDescription,
            keyUsage: keyConfig?.keyUsage || "ENCRYPT_DECRYPT",
            customerMasterKeySpec: keyConfig?.keySpec || "SYMMETRIC_DEFAULT",
            multiRegion: multiRegion,
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

        /**
         * Create replica in other region if multiRegion is enabled
         */
        let replicas: aws.kms.ReplicaKey[] | undefined;
        let replicaAliases: aws.kms.Alias[] | undefined;

        if (multiRegion && providerReplica) {
            // Create replica key
            const replicaKey = new aws.kms.ReplicaKey(`${this.config.project}-${name}-kms-replica`, {
                description: keyDescription,
                primaryKeyArn: key.arn,
                deletionWindowInDays: keyConfig?.deletionWindowInDays || 7,
                tags: {
                    ...this.config.generalTags,
                    Name: `${keyName}-replica`,
                    ...keyConfig?.tags
                }
            }, {provider: providerReplica});

            replicas = [replicaKey];

            if (createAlias) {
                // Create alias for replica
                const replicaAlias = new aws.kms.Alias(`${this.config.project}-${name}-kms-alias-replica`, {
                    name: `alias/${this.config.generalPrefix}-${name}-kms-replica`,
                    targetKeyId: replicaKey.keyId,
                }, {provider: providerReplica});

                replicaAliases = [replicaAlias];
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