/**
 * Commande /broadcast - Diffusion de message à tous les utilisateurs (Admin seulement)
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Message à diffuser
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdBroadcast(senderId, args, ctx) { 
    const { isAdmin, userList, sendMessage, sleep, log } = ctx;
    
    if (!isAdmin(senderId)) {
        return `🔐 Oh ! Accès réservé aux admins seulement !\nTon ID: ${senderId}\n💕 Mais tu peux utiliser /help pour voir mes autres commandes !`;
    }
    
    if (!args.trim()) {
        return `📢 COMMANDE BROADCAST ADMIN
Usage: /broadcast [message]

📊 Mes petits utilisateurs connectés: ${userList.size} 💕
🔐 Commande réservée aux admins`;
    }
    
    const messageText = args.trim();
    
    if (messageText.length > 1800) {
        return "❌ Oh non ! Ton message est trop long ! Maximum 1800 caractères s'il te plaît ! 💕";
    }
    
    if (userList.size === 0) {
        return "📢 Aucun utilisateur connecté pour le moment ! 🌸";
    }
    
    // Message final
    const formattedMessage = `📢 ANNONCE OFFICIELLE DE NAKAMABOT 💖\n\n${messageText}\n\n— Avec tout mon amour, NakamaBot (créée par Durand) ✨`;
    
    // Envoyer à tous les utilisateurs
    let sent = 0;
    let errors = 0;
    const total = userList.size;
    
    log.info(`📢 Début broadcast vers ${total} utilisateurs`);
    
    for (const userId of userList) {
        try {
            if (!userId || !String(userId).trim()) {
                continue;
            }
            
            await sleep(200); // Éviter le spam
            
            const result = await sendMessage(String(userId), formattedMessage);
            if (result.success) {
                sent++;
                log.debug(`✅ Broadcast envoyé à ${userId}`);
            } else {
                errors++;
                log.warning(`❌ Échec broadcast pour ${userId}`);
            }
        } catch (error) {
            errors++;
            log.error(`❌ Erreur broadcast pour ${userId}: ${error.message}`);
        }
    }
    
    log.info(`📊 Broadcast terminé: ${sent} succès, ${errors} erreurs`);
    const successRate = total > 0 ? (sent / total * 100) : 0;
    
    return `📊 BROADCAST ENVOYÉ AVEC AMOUR ! 💕

✅ Messages réussis : ${sent}
📱 Total d'amis : ${total}
❌ Petites erreurs : ${errors}
📈 Taux de réussite : ${successRate.toFixed(1)}% 🌟`;
};
