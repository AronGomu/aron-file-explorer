import websocket, json, time, base64
from pathlib import Path
ROOT=Path.cwd()
EVIDENCE=ROOT/'artifacts/selection-deletion'
EVIDENCE.mkdir(parents=True,exist_ok=True)
class Native:
    def __init__(self):
        self.ws=websocket.create_connection('ws://127.0.0.1:9234/socket/1/1/WebPage',timeout=8)
        self.target=None; self.sequence=0
        while self.target is None:
            message=json.loads(self.ws.recv())
            if message.get('method')=='Target.targetCreated' and message['params']['targetInfo']['type']=='page': self.target=message['params']['targetInfo']['targetId']
    def call(self,method,params):
        self.sequence+=1; seq=self.sequence
        self.ws.send(json.dumps({'id':seq+1000,'method':'Target.sendMessageToTarget','params':{'targetId':self.target,'message':json.dumps({'id':seq,'method':method,'params':params})}}))
        while True:
            message=json.loads(self.ws.recv())
            if message.get('method')=='Target.dispatchMessageFromTarget':
                inner=json.loads(message['params']['message'])
                if inner.get('id')==seq:
                    if 'error' in inner: raise Exception(inner['error'])
                    return inner['result']
    def js(self,code):
        result=self.call('Runtime.evaluate',{'expression':code,'returnByValue':True})
        if result.get('wasThrown'): raise Exception(result)
        return result['result'].get('value')
    def wait(self,code):
        for _ in range(100):
            if self.js(code): return
            time.sleep(.05)
        raise AssertionError(code)
    def key(self,key,**modifiers):
        self.js('document.activeElement?.blur();document.body.dispatchEvent(new KeyboardEvent("keydown",'+json.dumps(dict(key=key,bubbles=True,cancelable=True,**modifiers))+'))')
        time.sleep(.07)
    def selected(self): return self.js('Array.from(document.querySelectorAll(".file-item.selected"),e=>e.dataset.path.split("/").at(-1))')
    def click_item(self,index):
        self.js(f'document.querySelectorAll(".file-item")[{index}].dispatchEvent(new MouseEvent("click",{{bubbles:true,detail:1}}))');time.sleep(.07)
    def screenshot(self,name):
        width,height=self.js('[innerWidth,innerHeight]')
        data=self.call('Page.snapshotRect',{'x':0,'y':0,'width':width,'height':height,'coordinateSystem':'Viewport'})
        (EVIDENCE/name).write_bytes(base64.b64decode(data['dataURL'].split(',',1)[1]))

if __name__=='__main__':
    n=Native()
    n.wait('document.querySelectorAll(".file-item").length===6')
    results=[]
    for mode,label in [('list','List view'),('grid','Icons view')]:
        n.js(f'document.querySelector("button[aria-label=\\"{label}\\"]").click()')
        n.wait(f'document.querySelector(".view-mode-{mode}.file-list-container")!==null')
        n.click_item(2)
        if n.selected()!=['charlie.txt']: n.click_item(2)
        n.key('ArrowRight',shiftKey=True);assert n.selected()==['charlie.txt','delta.txt'],n.selected()
        n.key('ArrowLeft',shiftKey=True);assert n.selected()==['charlie.txt'],n.selected()
        n.key('ArrowLeft',shiftKey=True);assert n.selected()==['bravo.txt','charlie.txt'],n.selected()
        n.screenshot(f'{mode}-shift-selection.png')
        results.append(f'{mode}: Shift+Arrow expands, shrinks and crosses anchor')
    n.key('Delete')
    n.wait('document.querySelector("[role=dialog]")!==null')
    assert len(list((ROOT/'.tmp/deletion-native/files').iterdir()))==6
    n.screenshot('multiple-delete-confirmation.png')
    n.js('document.querySelector("[role=dialog] button").click()')
    n.wait('document.querySelector("[role=dialog]")===null')
    assert len(list((ROOT/'.tmp/deletion-native/files').iterdir()))==6
    n.key('Delete')
    n.wait('document.querySelector("[role=dialog]")!==null')
    n.js('document.querySelectorAll("[role=dialog] button")[1].click()')
    n.wait('document.querySelectorAll(".file-item").length===4')
    assert len(list((ROOT/'.tmp/deletion-native/files').iterdir()))==4
    trash=ROOT/'.tmp/deletion-native/data/Trash'
    assert len(list((trash/'info').iterdir()))==2
    n.key('z',ctrlKey=True)
    n.wait('document.querySelectorAll(".file-item").length===6')
    assert len(list((ROOT/'.tmp/deletion-native/files').iterdir()))==6
    n.screenshot('undo-restored.png')
    results.append('Delete: batch confirmation cancels safely; confirmation trashes both selected files; Ctrl+Z restores both')
    (EVIDENCE/'native-results.json').write_text(json.dumps(results,indent=2))
    print(json.dumps(results,indent=2))
