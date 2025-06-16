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
};