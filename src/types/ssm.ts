/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export type SsmParamConfig = {
    name: string;
    type: aws.ssm.ParameterType;
    value: string;
    description?: string;
    ignoreChanges?: boolean;
};

export type ParamStoreModuleConfig = {
    paramsPath: string;
    kmsKey?: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>;
};

export type SSMAssociationsModuleConfig = {
    schedule?: string;
    operatingSystem?: string;
    patchClassification?: string[];
    rebootOption?: string;
    tagKey?: string;
    tagValue?: string;
};

export type SSMAssociationsResult = {
    patchBaseline: aws.ssm.PatchBaseline;
    patchGroup: aws.ssm.PatchGroup;
    association: aws.ssm.Association;
};
