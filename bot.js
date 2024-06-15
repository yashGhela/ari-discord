require('dotenv').config()
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const axios = require('axios')
const {createClient} = require('@supabase/supabase-js')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE)

const apiKey = process.env.REPLICATE_API_TOKEN
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel]
});

client.once('ready', () => {
    console.log('Bot is online!');
});


let userId;

async function chatbot(userId, userPrompt){

    try{

        const { data, error } = await supabase.from('To-Dos').select('*').eq('UID', userId).limit(50).order('due_date', { ascending: false });
        if (error) {
            console.log('Error fetching todos:', error);
            throw error;
        }

        

        const { bdata, berror } = await supabase.from('Boards').select('*').eq('UID', userId);
        if (berror) {
            console.log('Error fetching boards:', berror);
            throw berror;
        }


        const today = new Date();


        let objArray = [];
        const obj = Object.fromEntries(data.entries());
        objArray.push(obj);


        const response = await fetch("https://api.replicate.com/v1/models/meta/meta-llama-3-70b-instruct/predictions", {
            method: 'POST',
            headers: {
                Authorization: `Token ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                input: {
                    prompt: "Prompt:" + userPrompt
                        
                        + `/////  Today is  ${today} THIS YOUR REFERENCE FOR DATES`
                        + '////Data Chunk for reading: ' + JSON.stringify(objArray)
                        + '///userid:' + userId
                        + '///userboards:' + JSON.stringify(bdata),
                    temperature: 0.8,
                    max_tokens: 7500,
                    system_prompt: "Instructions [YOU ONLY RESPOND IN THE GIVEN FORMATS NO OTHER WAY]:"
                        + "Aruarian, an AI assistant for task management, capable of adding, deleting, updating, and reading tasks for users via a database connection, assisting in task prioritization and identifying unnecessary tasks. Upon receiving a prompt, Aruarian determines if it's an action (insert, update, delete, batch_insert,text) and responds with a string with a JSON object inside in the specified format."
                        + "For text you just return a response message. For insert responses, it includes action, responseMessage, content, board and due_date."
                        + "For batch insert actions you perform the same actions as insert but instead return an array of objects to insert. For read actions, it retrieves all user todos as a JSON object, analyzes the prompt to determine if it requires a specific or batch response, and formats the response accordingly."
                        + "Only JSON responses are provided, functions: [insert, update, read, batch_insert, text], update_response_format:{action:update, responseMessage:Your response to the prompt, update_field(the field being updated), updatedata: the new data to go into that field, TID:the exact TID of the task}, batch_insert_response_format:{action:batchinsert, responseMessage: Your response to the prompt, tasks:[array of tasks to be added, with the following fields: content, due_date, board]},"
                        + "insert_response_format:{action: insert, responseMessage: Your response to the prompt(must use context of prompt, cant just be: task added succesffuly), content, due_date, board:from prompt or simply General}, read_steps: You must answer the user's question and return either a list or a single item from the datachunk, JSON response format:{action:read, responseMessage: Your response to the prompt, taskOrder: An list of tasks with no []s and no \"\"s formated with just their content fields and if their status is complete the ✅ emoji and if they are incomplete the ⏹️ emoji  }, you only return JSON in this format, text_respone_format:{action: text, responseMessage:(your response to the prompt)}"
                },
            })
        });


        if (response.status !== 201) {
            let error = await response.json();
            console.log('Error from Replicate API:', error.detail);
            throw new Error(error.detail);
        }

        const prediction = await response.json();

        while (
            prediction.status !== 'succeeded' &&
            prediction.status !== 'failed'
        ) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const updatedResponse = await fetch(
                `https://api.replicate.com/v1/predictions/${prediction.id}`,
                {
                    headers: {
                        Authorization: `Token ${apiKey}`,
                        "Content-Type": "application/json",
                    },
                }
            );

            if (updatedResponse.status !== 200) {
                let error = await updatedResponse.json();
                throw new Error(error.detail);
            }

            const updatedPrediction = await updatedResponse.json();
            if (updatedPrediction.status === 'succeeded') {
                const text = updatedPrediction.output;
                const jsonString = text.join('').trim();
                let jsonObject;
                try {
                    jsonObject = JSON.parse(jsonString);
                } catch (error) {
                    console.error("Error parsing JSON:", error);
                    throw error;
                }

                if (jsonObject.action === 'insert') {
                    const { data, error } = await supabase.from('To-Dos').insert({
                        content: jsonObject.content,
                        UID: userId,
                        due_date: jsonObject.due_date,
                        board: jsonObject.board
                    });

                    if (error) {
                        console.log(error);
                        throw error;
                    } else {
                        return jsonObject.responseMessage;
                    }
                } else if (jsonObject.action === 'read') {
                    return `${jsonObject.responseMessage}\n ${JSON.stringify(jsonObject.taskOrder)}`;
                } else if (jsonObject.action === 'update') {
                    const updateField = jsonObject.update_field;
                    const data = jsonObject.updatedata;

                    const { tdata, error } = await supabase.from('To-Dos').update(
                        { [updateField]: data }
                    ).eq('tid', jsonObject.TID);

                    if (error) {
                        console.log(error);
                        throw error;
                    } else {
                        return jsonObject.responseMessage;
                    }
                } else if (jsonObject.action === 'batchinsert' || jsonObject.action === 'batch_insert') {
                    const tasks = jsonObject.tasks;

                    const { data, error } = await supabase.from('To-Dos').insert(tasks);

                    if (error) {
                        console.log(error);
                        throw error;
                    } else {
                        return `${jsonObject.responseMessage}`;
                    }
                } else if (jsonObject.action === 'text') {
                    return jsonObject.responseMessage;
                }
            }
        }
       
    }catch(error){
        throw error
    }

}

async function registerorlogin(discordUser){
    try{
        const {data, error} = await supabase
        .from('Users')
        .select('discord_id')
        .eq('discord_id', discordUser.id)
        .single()

        if (error && error.code === 'PGRST116'){
            const {data:newUser, error:insertError}= await supabase
            .from('Users')
            .insert([
                {
                    discord_id:discordUser.id,
                    username: discordUser.username
                }
            ])
            .single()

            if(insertError){
                console.error('Error creating new user:', insertError);
                throw insertError;
            }

            console.log(newUser)

         
        }else if (error){
            console.error('Error fetching user:',error);
            throw error
        }
        
       
    }catch(error){
        throw error
    }
}


async function handleMessage(message) {
    if (message.author.bot) return;

    try {
        // Register or login the user
        await registerorlogin(message.author);

    
        userId=message.author.id
        console.log(userId)



        // Process natural language input with Replicate and Supabase
        const processedText = await chatbot(userId, message.content);

        // Reply to the user
        message.reply(` ${processedText}`);
    } catch (err) {
        console.error('Error handling message:', err);
        message.reply('There was an error processing your request. Please try again ');
    }
}

client.on('messageCreate', handleMessage);

// Log in to Discord
client.login(process.env.DISCORD_TOKEN);
