import { Element, Flow , EventBasedGateway} from '.';

import { Token, TOKEN_TYPE } from '../engine/Token';
import { NODE_ACTION, FLOW_ACTION, EXECUTION_EVENT, TOKEN_STATUS, ITEM_STATUS, NODE_SUBTYPE} from '../interfaces/Enums';
import { Item } from '../engine/Item';
import { BPMN_TYPE } from '../interfaces/Enums';
import { BehaviourLoader } from './behaviours/BehaviourLoader';

// ---------------------------------------------
class Node extends Element {
    name;
    process;
    def;
    outbounds: Flow[];
    inbounds: Flow[];
    attachments: Node[];
    attachedTo: Node;
    messageId;
    signalId;
    initiator;
    assignee;
    scripts = new Map();
    get processId() : any {

        return this.process.id;
    } 

    constructor(id, process , type, def) {
        super();
        this.id = id;
        this.process = process;
        this.type = type;
        this.def = def;
        this.inbounds = [];
        this.outbounds = [];
        this.name = def.name;
        this.attachments = [];

        BehaviourLoader.load(this);
    }
    async doEvent(item: Item, event: EXECUTION_EVENT, newStatus: ITEM_STATUS) {
        item.token.log('Node('+this.name+'|'+this.id+').doEvent: executing script for event:' + event + ' newStatus:'+newStatus);
        if (newStatus)
            item.status = newStatus;
        ///item.token.log('..>' + event + ' ' + this.id);
        const scripts = this.scripts.get(event);
        if (scripts) {
            for (var s = 0; s < scripts.length; s++) {
                var script = scripts[s];
                item.token.log('--executing script for event:' + event);

                await item.token.execution.appDelegate.scopeJS(item, script);

            }
        }
        return await item.token.execution.doItemEvent(item, event);

    }
    /**
     * is Called after execution 
     * transform data using input rules
     * todo
     * @param item
     */
    async setInput(item: Item, input) {
        item.token.log('Node('+this.name+'|'+this.id+').setInput: input' + JSON.stringify(input));
        //
        //item.token.log('--setting input ' + JSON.stringify(input));

        const data = await this.getInput(item, input);

        item.token.appendData(data);

    }
    async getInput(item: Item, input) {
        item.token.log('Node('+this.name+'|'+this.id+').getInput: input' + JSON.stringify(input));

        item.input = input;

        await this.doEvent(item, EXECUTION_EVENT.transform_input, null);

        return item.input;
    }
    /**
     * transform data using output rules
     * todo
     * @param item
     */
    async getOutput(item: Item) {
        return item.output;

    }
    enter(item: Item) {
        item.token.log('Node('+this.name+'|'+this.id+').enter: item=' + item.id);
        item.startedAt = new Date().toISOString();;

    }
    /*
     * does the need require to go into wait 
     * tasks like UserTasks, receiveTask, timer 
     */
    get requiresWait() { return false; }
    /* 
     * Can the Node be invoked externally (not from the workflow)
     * tasks like UserTasks, receiveTask, or events like receive,signal can be invoked
     */
    get canBeInvoked() { return false; }

    get isCatching(): boolean { return false; } // catching events and tasks
    /**
     * this is the primary exectuion method for a node
     * 
     * considerations: the following are handled by Token
     *      1.  Loops we are inside a loop already (if any)
     *      2.  Gatways 
     *      3.  Subprocess the parent node is fired as normal
     *              run method will fire the subprocess invoking a new token and will go into wait
     */
    async execute(item: Item) {
        item.token.log('Node('+this.name+'|'+this.id+').execute: item=' + item.id+' token:'+item.token.id);

        //  2  enter
        //  --------
        item.token.log('Node('+this.name+'|'+this.id+').execute: execute enter ...');
        await this.doEvent(item, EXECUTION_EVENT.node_enter, ITEM_STATUS.enter);

        this.enter(item);   // no choice
        const behaviourlist = [];
        this.behaviours.forEach(b => { behaviourlist.push(b) });


        for (var i = 0; i < behaviourlist.length; i++) {
            const b = behaviourlist[i];
            const bRet = await b.enter(item);
        }


        //  3   start
        //  --------
        item.token.log('Node('+this.name+'|'+this.id+').execute: execute start ...');

        await this.doEvent(item, EXECUTION_EVENT.node_start, ITEM_STATUS.start);

        let ret =await this.start(item);

        item.token.log('Node('+this.name+'|'+this.id+').execute: start complete ...token:'+item.token.id+' ret:'+ret);

        for (var i = 0; i < behaviourlist.length; i++) {
            const b = behaviourlist[i];
            const bRet = await b.start(item);
            if (bRet > ret) ret = bRet;
        }
        // check for attachments - boundary events:

        if (ret == NODE_ACTION.error || ret == NODE_ACTION.abort)
            return ret;
        else if (ret ==NODE_ACTION.wait) {
            await this.doEvent(item, EXECUTION_EVENT.node_wait, ITEM_STATUS.wait);
            return ret;
        }
        else if (ret ==NODE_ACTION.end) {
            await this.doEvent(item, EXECUTION_EVENT.node_end, ITEM_STATUS.end);
            return ret;
        }
        //  4   run  perform the work
        //  --------
        //  Save before performing the work
        await item.token.execution.save();
        item.token.log('Node('+this.name+'|'+this.id+').execute: execute run ...token:'+item.token.id);
        //item.token.log('..>run ' + this.id);

        ret = await this.run(item);
        switch (ret) {
            case NODE_ACTION.error:
                return ret;
                break;
            case NODE_ACTION.abort:
                return ret;
                break;
        }
        //  5   continue    
        //  --------
        //          end

        item.token.log('Node('+this.name+'|'+this.id+').execute: execute continue...');

        return await this.continue(item);

    }
    /*
     *  called by execute or by token.invoke to continue work already started
     */
    async continue(item: Item) {
        item.token.log('Node('+this.name+'|'+this.id+').continue: item=' + item.id);
        await this.end(item);
        return;
    }
    async start(item: Item): Promise<NODE_ACTION> {
        item.token.log('Node('+this.name+'|'+this.id+').start: item=' + item.id);

        await this.startBoundaryEvents(item, item.token);
        if (this.requiresWait) {
            return NODE_ACTION.wait;
        }
        return NODE_ACTION.continue;
    }

    async run(item: Item): Promise<NODE_ACTION> {
        item.token.log('Node('+this.name+'|'+this.id+').run: item=' + item.id);
        return NODE_ACTION.end;
    }
    async cancelEBG(item) {
        const ebgItem=item.token.originItem;
        if (ebgItem && ebgItem.node.type===BPMN_TYPE.EventBasedGateway)
        {   // we need to cancel all other events 
            const ebg=(ebgItem.node) as EventBasedGateway;
            await ebg.cancelAllBranched(item);
        }
    }
    async cancelBoundaryEvents(item) {
        // cancel boundary events
        let i,t;
        for (i = 0; i < this.attachments.length; i++) {
            let boundaryEvent = this.attachments[i];
            item.token.log('        boundaryEvent:'+boundaryEvent.id);
            let childrenTokens;
            if (this.type==BPMN_TYPE.SubProcess) // subprocess
            {
                //find the subprocess token
                item.token.execution.tokens.forEach(tok =>
                {
                    if (tok.originItem)
                    {
                       //item.token.log('--check token :'+tok.id+' ' +tok.originItem.id+' '+item.id);
                        if (tok.originItem.id == item.id && tok.type==TOKEN_TYPE.SubProcess)
                            childrenTokens = tok.getChildrenTokens();
                    }
                });
            }
            else            
                childrenTokens = item.token.getChildrenTokens();

            for (t = 0; t < childrenTokens.length; t++) {
                let token = childrenTokens[t];
                item.token.log('     childToken:'+token.id+' startnode:'+token.startNodeId+' status:'+token.currentItem.status);
                if (token.startNodeId == boundaryEvent.id) {
                    if (token.currentItem.status != ITEM_STATUS.end)
                        await token.terminate();
                }
            }
        }
    }
    async end(item: Item,cancel:Boolean=false) {
        item.token.log('Node('+this.name+'|'+this.id+').end: item=' + item.id+ ' cancel:'+cancel + ' attachments:'+this.attachments.length);
        /**
         * Rule:    boundary events are canceled when owner task status is 'end'
         * */
        await this.cancelBoundaryEvents(item);
        if (cancel===false)
            await this.cancelEBG(item);
        let i;
        for (i = 0; i < this.outbounds.length; i++) {
            let flow = this.outbounds[i];
                if (flow.type == BPMN_TYPE.MessageFlow) {
                    let flowItem = new Item(flow, item.token);
                    await flow.execute(flowItem);
                }
        }

        if (cancel)
            item.endedAt = null;
        else
            item.endedAt = new Date().toISOString();

        if (item.status == ITEM_STATUS.end)
            return;
        this.behaviours.forEach(async function (b) { await b.end(item); });
        await this.doEvent(item, EXECUTION_EVENT.node_end, ITEM_STATUS.end);
        item.token.log('Node('+this.name+'|'+this.id+').end: setting item status to end itemId=' + item.id + ' itemStatus=' + item.status + ' cancel: '+cancel+' endedat '+item.endedAt);
        this.behaviours.forEach(async function (b) { await b.exit(item); });
        item.token.log('Node(' + this.name + '|' + this.id + ').end: finished');
    }
    /**
     * is called by the token after an execution resume for every active (in wait) item
     * different than init, which is called for all items
     * @param item
     */
    resume(item: Item) {

    }
    init(item: Item) {

    }
    /* to be overwritten by XOR gateway */

    getOutbounds(item: Item): Item[] {
        item.token.log('Node('+this.name+'|'+this.id+').getOutbounds: itemId='+item.id);
        const outbounds = [];
        this.outbounds.forEach(flow => {
            if (flow.type == BPMN_TYPE.MessageFlow) {

            }
            else {
                let flowItem = new Item(flow, item.token);
                if (flow.run(flowItem) == FLOW_ACTION.take)
                    outbounds.push(flowItem);
                else 
                    flowItem.token=null;
            }
        });
        //item.token.log('..return outbounds' + outbounds.length);
        item.token.log('Node('+this.name+'|'+this.id+').getOutbounds: return outbounds'+outbounds.length);
        return outbounds;
    }
    async startBoundaryEvents(item,token) {
        item.token.log('Node('+this.name+'|'+this.id+').startBoundaryEvents: itemId='+item.id);
        let i;
        // check for attachments - boundary events:
        for (i = 0; i < this.attachments.length; i++) {
            let event = this.attachments[i];
            if (event.subType!==NODE_SUBTYPE.compensate)
                await Token.startNewToken(TOKEN_TYPE.BoundaryEvent, item.token.execution, event, null, token, item, null);
        }


    }
}


export { Node}