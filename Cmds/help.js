/**
 * Commande /help - Affichage de l'aide
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdHelp(senderId, args, ctx) {
    const { isAdmin } = ctx;
    
    let text = `╔═══════════╗
║ 🤖 NAKAMABOT v4.0 HELP 🤖 ║
╚═══════════╝

✨ COMMANDES PRINCIPALES:

🏠 BASE:
┣━━ /start - Ma présentation mignonne
┣━━ /help - Cette aide pleine d'amour
┗━━ /chat [msg] - Papote avec gentillesse

🎵 MÉDIA:
┣━━ /music - Trouve ta musique YouTube
┣━━ /image [desc] - Crée des images IA
┣━━ /anime - Transforme en style anime
┗━━ /vision - Décris tes images

⚔️ CLANS:
┗━━ /clan - Univers de guerre virtuelle`;

    if (isAdmin(senderId)) {
        text += `

🔐 ADMIN SPÉCIAL:
┣━━ /stats - Mes statistiques
┣━━ /admin - Panneau admin
┣━━ /broadcast [msg] - Diffusion
┗━━ /restart - Redémarrage`;
    }

    text += `

════════════════════════
🎨 Images: Envoie ta description !
🎭 Anime: Image + /anime !
👁️ Vision: Image + /vision !

╰─▸ Créé avec 💕 par Durand
💖 Toujours là pour t'aider ! ✨`;
    
    return text;
};
