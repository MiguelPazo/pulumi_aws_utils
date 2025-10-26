/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */

interface EcsServiceConfig {
    asgDesiredCount: number;
    asgMinCount: number;
    asgMaxCount: number;
}

export interface EcsServicesConfig {
    [serviceName: string]: EcsServiceConfig;
}

export type LambdaConfig = {
    name: string;
    policy?: string;
    assume?: boolean;
};

export type Cidr = {
    description: string;
    cidr: string;
};

export type VpceDnsOutput = {
    dnsName: string;
    hostedZoneId: string;
};