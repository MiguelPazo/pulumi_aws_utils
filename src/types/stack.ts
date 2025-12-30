/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */

interface EcsServiceConfig {
    asgEnabled: boolean;
    asgDesiredCount: number;
    asgMinCount?: number;
    asgMaxCount?: number;
}

export interface EcsServicesConfig {
    [serviceName: string]: EcsServiceConfig;
}

export type LambdaFunctionConfig = {
    name?: string;
    nameFull?: string;
};

export type LambdaConfig = {
    name: string;
    policy?: string;
    assume?: boolean;
    functions?: LambdaFunctionConfig[];
};

export type Cidr = {
    description: string;
    cidr: string;
};

export type VpceDnsOutput = {
    dnsName: string;
    hostedZoneId: string;
};