-- CreateTable                                                                                          
  CREATE TABLE `custom_emojis` (                                                                          
    `id` VARCHAR(191) NOT NULL,                                                                           
    `name` VARCHAR(191) NOT NULL,                                                                         
    `url` VARCHAR(191) NOT NULL,                                                                          
    `createdBy` VARCHAR(191) NOT NULL,                                                                    
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),                                        
                                                                                                          
    UNIQUE INDEX `CustomEmoji_name_key`(`name`),                                                          
    PRIMARY KEY (`id`)                                                                                    
  );                                             