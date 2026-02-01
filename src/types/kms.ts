/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export type KmsKeyConfig = {
    description?: string;
    keyUsage?: "ENCRYPT_DECRYPT" | "SIGN_VERIFY" | "GENERATE_VERIFY_MAC";
    keySpec?: "SYMMETRIC_DEFAULT" | "RSA_2048" | "RSA_3072" | "RSA_4096" | "ECC_NIST_P256" | "ECC_NIST_P384" | "ECC_NIST_P521" | "ECC_SECG_P256K1" | "HMAC_224" | "HMAC_256" | "HMAC_384" | "HMAC_512" | "SM2";
    deletionWindowInDays?: number;
    enableKeyRotation?: boolean;
    policy?: string;
    tags?: Record<string, string>;
};

export type KmsModuleConfig = {
    name: string;
    keyConfig?: KmsKeyConfig;
    createAlias?: boolean;
    additionalStatements?: any[];
    provider?: aws.Provider;
    enableMultiregion?: boolean;
    additionalReplicas?: aws.Provider[];
};

export type KmsAliasConfig = {
    name: string;
    targetKeyId: string;
};

export type KmsKeyResult = {
    key: aws.kms.Key | aws.kms.ReplicaKey;
    alias?: aws.kms.Alias;
    replicas?: aws.kms.ReplicaKey[];
    replicaAliases?: aws.kms.Alias[];
};