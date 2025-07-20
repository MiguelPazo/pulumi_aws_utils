/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export type RdsConfig = {
    name: string;
    allocatedStorage: number;
    engine: string;
    engineVersion: string;
    instanceClass: string;
    port: number;
    username: pulumi.Output<string>;
    password: pulumi.Output<string>;
    parameterGroupFamily: string;
    parameterGroupValues: { name: string; value: string; }[];
    skipFinalSnapshot: boolean;
    publiclyAccessible: boolean;
    domainRdsReader?: string;
    domainRdsWriter?: string;
};

export type RdsResult = {
    instance: aws.rds.Instance;
    kms: aws.kms.Key;
    securityGroup: aws.ec2.SecurityGroup;
};
