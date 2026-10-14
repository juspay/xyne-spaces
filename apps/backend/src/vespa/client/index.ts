
import config, { CLUSTER, NAMESPACE } from "../vespaConfig"
import { logger } from "@/utils/logger"
import { createVespaService, createDefaultConfig, type VespaDependencies } from "../src"

const vespaConfig = createDefaultConfig({
    page: config.VespaPageSize,
    isDebugMode: config.isDebugMode,
    namespace: NAMESPACE,
    cluster: CLUSTER,
    vespaMaxRetryAttempts: config.vespaMaxRetryAttempts,
    vespaRetryDelay: config.vespaRetryDelay,
    feedEndpoint: config.vespaEndpoint.feedEndpoint,
    queryEndpoint: config.vespaEndpoint.queryEndpoint,
})

const dependencies: VespaDependencies = {
    logger,
    config: vespaConfig,
}

const vespaService = createVespaService(dependencies)

export default {
    channelService: vespaService.channelService,
    crudService: vespaService.crudService,
}
