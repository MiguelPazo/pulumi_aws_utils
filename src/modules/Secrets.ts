/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {InitConfig} from "../types/module";
import {SecretsConfig, SecretsResult} from "../types";
import {getInit} from "../config";

class Secrets {
    private static __instance: Secrets;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): Secrets {
        if (this.__instance == null) {
            this.__instance = new Secrets();
        }

        return this.__instance;
    }

    async main(config: SecretsConfig): Promise<SecretsResult> {
        const {
            name,
            kmsKey,
            secretString = {delete: "me"},
            description,
            recoveryWindowInDays = 30,
            forceOverwriteReplicaSecret = true,
            kmsKeyReplica,
            enableMultiregion = false,
            tags
        } = config;

        const multiRegion = (enableMultiregion && this.config.multiRegion) || false;
        const failoverReplica = this.config.failoverReplica || false;
        const regionReplica = this.config.regionReplica;
        const providerReplica = this.config.providerReplica;

        /**
         * Handle failover replica scenario - get existing secret
         */
        if (multiRegion && failoverReplica) {
            if (!regionReplica) {
                throw new Error("regionReplica is required when failoverReplica is true");
            }

            const secretNameReplica = `${this.config.generalPrefixMultiregion}-${name}`;

            // Lookup the secret ARN by name using getSecretOutput (returns Output<GetSecretResult>)
            const secretData = aws.secretsmanager.getSecretOutput({
                name: secretNameReplica
            }, providerReplica ? {provider: providerReplica} : undefined);

            // Get the secret resource using the ARN from the output
            const existingSecret = aws.secretsmanager.Secret.get(
                `${this.config.project}-${name}-secret-replica`,
                secretData.arn,
                undefined,
                providerReplica ? {provider: providerReplica} : undefined
            );

            return {
                secret: existingSecret
            };
        }

        const secretName = `${this.config.generalPrefix}-${name}`;

        /**
         * Validate multi-region requirements
         */
        if (multiRegion) {
            if (!regionReplica) {
                throw new Error("regionReplica is required when multiRegion is true");
            }
            if (!kmsKeyReplica) {
                throw new Error("kmsKeyReplica is required when multiRegion is true");
            }
        }

        /**
         * Create primary secret with optional replicas
         */
        const secret = new aws.secretsmanager.Secret(`${this.config.project}-${name}-secret`, {
            name: secretName,
            description: description,
            kmsKeyId: kmsKey?.keyId,
            recoveryWindowInDays: recoveryWindowInDays,
            forceOverwriteReplicaSecret: forceOverwriteReplicaSecret,
            // Configure replicas for multi-region if enabled
            ...(multiRegion && regionReplica && {
                replicas: [{
                    region: regionReplica,
                    kmsKeyId: kmsKeyReplica?.keyId
                }]
            }),
            tags: {
                ...this.config.generalTags,
                Name: secretName,
                ...tags
            }
        });

        /**
         * Create secret version with secretString
         */
        const secretVersion = new aws.secretsmanager.SecretVersion(`${this.config.project}-${name}-secret-version`, {
            secretId: secret.id,
            secretString: JSON.stringify(secretString)
        }, {
            ignoreChanges: ["secretString", "versionStages"]
        });

        return {
            secret,
            secretVersion
        } as SecretsResult;
    }
}

export {Secrets}
