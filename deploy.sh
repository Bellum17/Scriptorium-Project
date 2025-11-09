#!/bin/bash
# Script de déploiement rapide pour Railway

echo "🚀 Préparation du déploiement Railway..."
echo ""

# Vérifier que nous sommes dans le bon dossier
if [ ! -f "bot.js" ]; then
    echo "❌ Erreur: bot.js non trouvé. Êtes-vous dans le bon dossier ?"
    exit 1
fi

# Vérifier que package-lock.json existe
if [ ! -f "package-lock.json" ]; then
    echo "⚠️  package-lock.json manquant. Régénération..."
    npm install
fi

echo "✅ Fichiers vérifiés"
echo ""

# Afficher le statut git
echo "📋 Statut Git:"
git status --short

echo ""
echo "📦 Fichiers qui seront committés:"
git add .
git status --short

echo ""
read -p "🤔 Continuer avec le commit et push ? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "💾 Commit en cours..."
    git commit -m "Fix: Régénération package-lock.json et simplification config Railway"
    
    echo ""
    echo "📤 Push vers GitHub..."
    git push
    
    echo ""
    echo "✅ Déploiement envoyé à Railway !"
    echo ""
    echo "🔍 Prochaines étapes:"
    echo "   1. Allez sur railway.app"
    echo "   2. Vérifiez les logs de déploiement"
    echo "   3. Attendez que le bot soit en ligne"
    echo "   4. Testez avec /personnage créer sur Discord"
    echo ""
else
    echo ""
    echo "❌ Déploiement annulé"
    exit 0
fi
