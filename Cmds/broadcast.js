// Cmds/broadcast.js
// Commande pour diffuser un message à tous les utilisateurs (admin seulement)
// Version complète avec protection anti-doublons renforcée

// ✅ État global du broadcast (singleton partagé)
let broadcastState = {
    isRunning: false,
    sessionId: null,           // ID unique pour chaque session
    currentMessage: null,
    processedUsers: new Set(), // Utilisateurs déjà traités (succès OU échec)
    successUsers: new Set(),   // Utilisateurs qui ont reçu le message
    failedUsers: new Set(),    // Utilisateurs en échec
    skippedUsers: new Set(),   // Utilisateurs ignorés (admin, doublons)
    totalTargetUsers: 0,       // Nombre d'utilisateurs cibles (sans admin)
    successCount: 0,
    errorCount: 0,
    skippedCount: 0,
    errorDetails: {
        blocked: 0,
        inactive: 0,
        rateLimit: 0,
        network: 0,
        other: 0
    },
    startTime: null,
    cancelled: false,
    adminId: null
};

// ✅ Fonction principale de la commande broadcast
module.exports = async function(senderId, args, context) {
    const {
        isAdmin,
        userList,
        sendMessage,
        addToMemory,
        saveDataImmediate,
        log,
        sleep
    } = context;

    const senderIdStr = String(senderId);

    try {
        // ✅ 1. VÉRIFICATION DES PERMISSIONS ADMIN
        if (!isAdmin(senderId)) {
            const response = "🚫 **Accès refusé !**\n\n⚠️ La commande de diffusion est réservée aux administrateurs.\n\n💡 Utilise `/help` pour voir les commandes disponibles.";
            addToMemory(senderId, 'user', '/broadcast');
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        // ✅ 2. VÉRIFICATION SI BROADCAST DÉJÀ EN COURS
        if (broadcastState.isRunning) {
            const elapsed = Math.round((Date.now() - broadcastState.startTime) / 1000);
            const totalProcessed = broadcastState.successCount + broadcastState.errorCount + broadcastState.skippedCount;
            const progress = `${totalProcessed}/${broadcastState.totalTargetUsers}`;
            
            const response = `🔄 **Diffusion déjà en cours !**\n\n📊 **Progression :** ${progress}\n✅ **Envoyés :** ${broadcastState.successCount}\n❌ **Erreurs :** ${broadcastState.errorCount}\n⏭️ **Ignorés :** ${broadcastState.skippedCount}\n⏱️ **Temps écoulé :** ${elapsed}s\n\n🛑 Utilise \`/stop-broadcast\` pour arrêter.`;
            
            addToMemory(senderId, 'user', '/broadcast');
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        // ✅ 3. VÉRIFICATION DU MESSAGE À DIFFUSER
        if (!args || args.trim().length === 0) {
            const totalUsers = userList.size;
            const targetUsers = Math.max(0, totalUsers - 1); // -1 pour exclure l'admin
            
            const response = `📢 **Commande Broadcast**\n\n🎯 **Usage :**\n\`/broadcast [votre message]\`\n\n📝 **Exemple :**\n\`/broadcast 🎉 Nouvelle fonctionnalité disponible !\`\n\n👥 **Utilisateurs enregistrés :** ${totalUsers}\n🎯 **Destinataires potentiels :** ${targetUsers}\n\n⚠️ **Important :** Le message sera envoyé à TOUS les utilisateurs !`;
            
            addToMemory(senderId, 'user', '/broadcast');
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        // ✅ 4. PRÉPARATION ET VALIDATION DU MESSAGE
        const userMessage = args.trim();
        const finalMessage = `📢 **Message de l'équipe NakamaBot :**\n\n${userMessage}\n\n✨ _Diffusion automatique - Tu peux continuer à me parler normalement !_ 💕`;

        // Vérification de la longueur
        if (finalMessage.length > 1800) {
            const excess = finalMessage.length - 1800;
            const response = `📝 **Message trop long !**\n\n📏 **Longueur actuelle :** ${finalMessage.length} caractères\n📏 **Maximum autorisé :** 1800 caractères\n📏 **À supprimer :** ${excess} caractères\n\n💡 Raccourcis ton message s'il te plaît.`;
            
            addToMemory(senderId, 'user', '/broadcast');
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        // ✅ 5. CALCUL DES UTILISATEURS CIBLES (EXCLUSION ADMIN)
        const allUsers = Array.from(userList);
        const targetUsers = allUsers.filter(userId => String(userId) !== String(senderId));
        
        if (targetUsers.length === 0) {
            const response = `👥 **Aucun destinataire !**\n\n📊 Il n'y a aucun utilisateur à contacter (hors admin).\n📈 **Total enregistrés :** ${allUsers.length}\n🔐 **Admins :** ${allUsers.length - targetUsers.length}\n\n💡 Les utilisateurs s'ajoutent automatiquement quand ils écrivent au bot.`;
            
            addToMemory(senderId, 'user', '/broadcast');
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        // ✅ 6. ENREGISTREMENT DE LA COMMANDE EN MÉMOIRE
        addToMemory(senderId, 'user', `/broadcast ${userMessage}`);

        // ✅ 7. INITIALISATION DE L'ÉTAT DU BROADCAST
        const sessionId = `broadcast_${Date.now()}_${senderId}`;
        
        broadcastState = {
            isRunning: true,
            sessionId: sessionId,
            currentMessage: finalMessage,
            processedUsers: new Set(),
            successUsers: new Set(),
            failedUsers: new Set(),
            skippedUsers: new Set([String(senderId)]), // Admin déjà dans les ignorés
            totalTargetUsers: targetUsers.length,
            successCount: 0,
            errorCount: 0,
            skippedCount: 1, // +1 pour l'admin
            errorDetails: {
                blocked: 0,
                inactive: 0,
                rateLimit: 0,
                network: 0,
                other: 0
            },
            startTime: Date.now(),
            cancelled: false,
            adminId: senderId
        };

        log.info(`📢 BROADCAST DÉMARRÉ [${sessionId}] par admin ${senderId} vers ${targetUsers.length} utilisateurs`);

        // ✅ 8. MESSAGE DE CONFIRMATION IMMÉDIAT
        const previewMessage = userMessage.length > 80 ? userMessage.substring(0, 80) + "..." : userMessage;
        const confirmResponse = `🚀 **Diffusion lancée !**\n\n👤 **Admin :** ${senderId}\n🆔 **Session :** ${sessionId.split('_')[1]}\n👥 **Destinataires :** ${targetUsers.length} utilisateurs\n📝 **Message :** "${previewMessage}"\n\n⏳ **Diffusion en cours...** \nJe t'enverrai un rapport détaillé à la fin !`;
        
        addToMemory(senderId, 'assistant', confirmResponse);

        // ✅ 9. LANCEMENT DU PROCESSUS ASYNCHRONE
        processBroadcastSafely(targetUsers, context)
            .then(() => {
                log.info(`✅ Broadcast [${sessionId}] terminé avec succès`);
            })
            .catch(error => {
                log.error(`❌ Erreur critique broadcast [${sessionId}]: ${error.message}`);
                // En cas d'erreur critique, réinitialiser l'état
                resetBroadcastState();
            });

        return confirmResponse;

    } catch (error) {
        log.error(`❌ Erreur dans broadcast command: ${error.message}`);
        
        // Réinitialiser en cas d'erreur
        resetBroadcastState();
        
        const errorResponse = `❌ **Erreur interne !**\n\n🔧 Une erreur s'est produite lors du lancement de la diffusion.\n📋 **Détails :** ${error.message}\n\n💡 Réessaie dans quelques instants.`;
        
        addToMemory(senderId, 'assistant', errorResponse);
        return errorResponse;
    }
};

// ✅ Fonction principale de traitement avec protection anti-doublons
async function processBroadcastSafely(targetUsers, context) {
    const { sendMessage, addToMemory, log, sleep } = context;
    const { sessionId, adminId, currentMessage } = broadcastState;
    
    const startTime = Date.now();
    log.info(`🔄 Début traitement broadcast [${sessionId}] - ${targetUsers.length} utilisateurs cibles`);

    // ✅ Test de connectivité initial
    try {
        const testResult = await sendMessage(adminId, `🔄 **Test de connectivité...**\n🆔 Session: ${sessionId.split('_')[1]}`);
        if (testResult.success) {
            log.info(`✅ Connectivité OK pour session [${sessionId}]`);
        }
    } catch (error) {
        log.warning(`⚠️ Test de connectivité échoué [${sessionId}]: ${error.message}`);
    }

    // ✅ TRAITEMENT UTILISATEUR PAR UTILISATEUR AVEC PROTECTION MAXIMALE
    for (let index = 0; index < targetUsers.length && !broadcastState.cancelled; index++) {
        const userId = targetUsers[index];
        const userIdStr = String(userId);

        try {
            // 🛡️ PROTECTION ANTI-DOUBLONS NIVEAU 1 : Vérification processedUsers
            if (broadcastState.processedUsers.has(userIdStr)) {
                log.debug(`⏭️ Utilisateur ${userId} déjà traité, ignorer`);
                continue;
            }

            // 🛡️ PROTECTION ANTI-DOUBLONS NIVEAU 2 : Vérification admin
            if (userIdStr === String(adminId)) {
                log.debug(`⏭️ Admin ${userId} ignoré automatiquement`);
                broadcastState.skippedUsers.add(userIdStr);
                broadcastState.processedUsers.add(userIdStr);
                continue;
            }

            // 🛡️ PROTECTION ANTI-DOUBLONS NIVEAU 3 : Vérification successUsers
            if (broadcastState.successUsers.has(userIdStr)) {
                log.debug(`⏭️ Utilisateur ${userId} déjà reçu le message avec succès`);
                broadcastState.processedUsers.add(userIdStr);
                continue;
            }

            // ✅ MARQUER COMME EN COURS DE TRAITEMENT
            broadcastState.processedUsers.add(userIdStr);

            log.debug(`📤 Tentative d'envoi à ${userId} [${index + 1}/${targetUsers.length}]`);

            // ✅ ENVOI DU MESSAGE AVEC RETRY ET TIMEOUT
            const sendResult = await sendMessageWithRetryAndTimeout(
                sendMessage, 
                userId, 
                currentMessage, 
                log, 
                3, // 3 tentatives max
                8000 // timeout 8 secondes
            );

            // ✅ TRAITEMENT DU RÉSULTAT
            if (sendResult.success) {
                // ✅ SUCCÈS : Marquer dans successUsers
                broadcastState.successUsers.add(userIdStr);
                broadcastState.successCount++;
                log.debug(`✅ Message envoyé avec succès à ${userId}`);
                
            } else {
                // ❌ ÉCHEC : Marquer dans failedUsers et catégoriser l'erreur
                broadcastState.failedUsers.add(userIdStr);
                broadcastState.errorCount++;
                categorizeErrorAdvanced(sendResult.error, broadcastState.errorDetails, log);
                log.warning(`❌ Échec envoi à ${userId}: ${sendResult.error}`);
            }

        } catch (exception) {
            // ❌ EXCEPTION : Traiter comme un échec
            broadcastState.processedUsers.add(userIdStr);
            broadcastState.failedUsers.add(userIdStr);
            broadcastState.errorCount++;
            categorizeErrorAdvanced(exception.message, broadcastState.errorDetails, log);
            log.error(`❌ Exception lors de l'envoi à ${userId}: ${exception.message}`);
        }

        // ✅ PAUSE ADAPTATIVE ENTRE LES ENVOIS
        if (index < targetUsers.length - 1 && !broadcastState.cancelled) {
            const currentErrorRate = broadcastState.errorCount / Math.max(1, index + 1);
            let pauseTime = 200; // Pause de base : 200ms
            
            // Augmenter la pause si taux d'erreur élevé
            if (currentErrorRate > 0.5) {
                pauseTime = 500; // 500ms si plus de 50% d'erreurs
            } else if (currentErrorRate > 0.3) {
                pauseTime = 350; // 350ms si plus de 30% d'erreurs
            }
            
            await sleep(pauseTime);
        }

        // ✅ RAPPORTS DE PROGRESSION PÉRIODIQUES
        const processed = index + 1;
        if (processed % 15 === 0 || processed === targetUsers.length) {
            const progressPercent = Math.round((processed / targetUsers.length) * 100);
            const errorRate = Math.round((broadcastState.errorCount / processed) * 100);
            
            log.info(`📊 Broadcast [${sessionId}] - ${progressPercent}% : ${broadcastState.successCount}✅ ${broadcastState.errorCount}❌ (${errorRate}% erreurs)`);
            
            // Rapport intermédiaire à l'admin tous les 30 utilisateurs
            if (processed % 30 === 0 && processed < targetUsers.length) {
                const intermediateReport = `📊 **Progression broadcast**\n\n🎯 **Avancement :** ${progressPercent}%\n✅ **Réussis :** ${broadcastState.successCount}\n❌ **Erreurs :** ${broadcastState.errorCount}\n📈 **Traités :** ${processed}/${targetUsers.length}\n⚠️ **Taux d'erreur :** ${errorRate}%\n\n⏳ **Diffusion en cours...**`;
                
                try {
                    await sendMessage(adminId, intermediateReport);
                } catch (e) {
                    log.warning(`⚠️ Impossible d'envoyer rapport intermédiaire [${sessionId}]: ${e.message}`);
                }
            }
        }
    }

    // ✅ GÉNÉRATION DU RAPPORT FINAL
    await generateFinalReport(context);
}

// ✅ Fonction d'envoi avec retry, timeout et gestion d'erreurs avancée
async function sendMessageWithRetryAndTimeout(sendMessage, userId, message, log, maxRetries = 3, timeoutMs = 8000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Promise avec timeout
            const sendPromise = sendMessage(userId, message);
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`Timeout après ${timeoutMs}ms`)), timeoutMs)
            );

            const result = await Promise.race([sendPromise, timeoutPromise]);
            
            if (result && result.success) {
                // Succès immédiat
                return result;
            } else if (result && !result.success) {
                // Échec mais réponse reçue
                if (attempt === maxRetries) {
                    return result;
                } else {
                    // Retry seulement si l'erreur peut être temporaire
                    const errorMsg = (result.error || "").toLowerCase();
                    if (errorMsg.includes("rate") || errorMsg.includes("timeout") || errorMsg.includes("network")) {
                        log.debug(`🔄 Retry ${attempt}/${maxRetries} pour ${userId} : ${result.error}`);
                        await sleep(attempt * 1500); // Pause croissante
                        continue;
                    } else {
                        // Erreur définitive (utilisateur bloqué, etc.)
                        return result;
                    }
                }
            } else {
                // Résultat undefined ou null
                if (attempt === maxRetries) {
                    return { success: false, error: "Réponse undefined du service de messagerie" };
                }
                await sleep(attempt * 1000);
            }

        } catch (error) {
            if (attempt === maxRetries) {
                return { success: false, error: error.message };
            } else {
                log.debug(`🔄 Exception retry ${attempt}/${maxRetries} pour ${userId} : ${error.message}`);
                await sleep(attempt * 1500);
            }
        }
    }

    return { success: false, error: "Échec après tous les retries" };
}

// ✅ Catégorisation avancée des erreurs
function categorizeErrorAdvanced(errorMessage, errorDetails, log) {
    if (!errorMessage) {
        errorDetails.other++;
        return;
    }

    const error = errorMessage.toLowerCase();
    
    if (error.includes('block') || error.includes('forbidden') || error.includes('user not found')) {
        errorDetails.blocked++;
    } else if (error.includes('inactive') || error.includes('unavailable') || error.includes('disabled')) {
        errorDetails.inactive++;
    } else if (error.includes('rate') || error.includes('limit') || error.includes('too many') || error.includes('quota')) {
        errorDetails.rateLimit++;
    } else if (error.includes('network') || error.includes('timeout') || error.includes('connection') || error.includes('dns')) {
        errorDetails.network++;
    } else {
        errorDetails.other++;
        log.debug(`❓ Erreur non catégorisée : ${errorMessage}`);
    }
}

// ✅ Génération du rapport final détaillé
async function generateFinalReport(context) {
    const { sendMessage, addToMemory, log } = context;
    const { sessionId, adminId, startTime, cancelled } = broadcastState;
    
    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);
    const totalProcessed = broadcastState.successCount + broadcastState.errorCount;
    const successRate = totalProcessed > 0 ? Math.round((broadcastState.successCount / totalProcessed) * 100) : 0;

    let finalReport;
    
    if (cancelled) {
        finalReport = `🛑 **Diffusion INTERROMPUE**\n\n🆔 **Session :** ${sessionId.split('_')[1]}\n📊 **Résultats partiels :**\n✅ **Envoyés :** ${broadcastState.successCount}\n❌ **Erreurs :** ${broadcastState.errorCount}\n⏭️ **Ignorés :** ${broadcastState.skippedCount}\n📈 **Traités :** ${totalProcessed}/${broadcastState.totalTargetUsers}\n⏱️ **Durée :** ${duration}s\n\n🔴 **Diffusion arrêtée par stop-broadcast**`;
        
        log.info(`🛑 Broadcast [${sessionId}] INTERROMPU : ${broadcastState.successCount}✅ ${broadcastState.errorCount}❌ en ${duration}s`);
    } else {
        finalReport = `🎉 **Diffusion TERMINÉE !**\n\n🆔 **Session :** ${sessionId.split('_')[1]}\n📊 **Rapport final :**\n✅ **Envoyés :** ${broadcastState.successCount}\n❌ **Erreurs :** ${broadcastState.errorCount}\n⏭️ **Ignorés :** ${broadcastState.skippedCount}\n📈 **Total traité :** ${totalProcessed}/${broadcastState.totalTargetUsers}\n📊 **Taux de réussite :** ${successRate}%\n⏱️ **Durée :** ${duration}s\n\n🔍 **Analyse des erreurs :**\n🚫 **Bloqués/Inexistants :** ${broadcastState.errorDetails.blocked}\n😴 **Inactifs/Indisponibles :** ${broadcastState.errorDetails.inactive}\n⏱️ **Limite de débit :** ${broadcastState.errorDetails.rateLimit}\n🌐 **Problèmes réseau :** ${broadcastState.errorDetails.network}\n❓ **Autres erreurs :** ${broadcastState.errorDetails.other}\n\n💕 **Message diffusé avec succès !**`;
        
        log.info(`🎉 Broadcast [${sessionId}] TERMINÉ : ${broadcastState.successCount}✅ ${broadcastState.errorCount}❌ en ${duration}s (${successRate}%)`);
    }

    // ✅ Envoyer le rapport final à l'admin
    try {
        const reportResult = await sendMessage(adminId, finalReport);
        if (reportResult && reportResult.success) {
            addToMemory(adminId, 'assistant', finalReport);
            log.info(`📋 Rapport final envoyé à l'admin ${adminId} pour session [${sessionId}]`);
        } else {
            log.error(`❌ Échec envoi rapport final à l'admin ${adminId} : ${reportResult ? reportResult.error : 'Réponse undefined'}`);
        }
    } catch (error) {
        log.error(`❌ Exception lors de l'envoi du rapport final [${sessionId}] : ${error.message}`);
    }

    // ✅ Réinitialiser l'état après rapport final
    resetBroadcastState();
}

// ✅ Fonction de réinitialisation de l'état
function resetBroadcastState() {
    broadcastState = {
        isRunning: false,
        sessionId: null,
        currentMessage: null,
        processedUsers: new Set(),
        successUsers: new Set(),
        failedUsers: new Set(),
        skippedUsers: new Set(),
        totalTargetUsers: 0,
        successCount: 0,
        errorCount: 0,
        skippedCount: 0,
        errorDetails: {
            blocked: 0,
            inactive: 0,
            rateLimit: 0,
            network: 0,
            other: 0
        },
        startTime: null,
        cancelled: false,
        adminId: null
    };
}

// ✅ Fonction utilitaire sleep
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ✅ Exports pour la commande stop-broadcast
module.exports.getBroadcastState = () => ({ ...broadcastState }); // Copie pour éviter les modifications externes
module.exports.setBroadcastCancelled = () => {
    if (broadcastState.isRunning) {
        broadcastState.cancelled = true;
        console.log(`🛑 Broadcast [${broadcastState.sessionId}] marqué pour annulation`);
    }
};
module.exports.resetBroadcastState = resetBroadcastState;
