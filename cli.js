const Chat = require('./chat');

const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const apiKey = process.env.KEY;

const url = process.env.URL;
const model = process.env.MODEL;
const modelsUrl = process.env.MODELS_URL;
const chat = new Chat({apiKey, modelsUrl, url, model});

process.stdout.write('> ');

rl.on('line', async line => {
    if (line.startsWith('.models')) {
        const search = line.startsWith('.models ') ? line.slice('.models '.length) : '';
        console.log('search', search);
        chat.models(search).then(({output: {models}}) => {
            models = models.filter(x => x.features.includes('web-search')).filter(x => x.published_time > '2026-05-20');
            models.sort((a, b) => a.published_time < b.published_time ? -1 : 0);
            models.forEach(x => console.log(x.published_time.split(' ')[0], x.name, x.model));
            process.stdout.write('> ');
        })
        return;
    }
    for await (const piece of chat.ask(line)) {
        process.stdout.write(piece.slice(1));
    }
    process.stdout.write('\n> ');
});
