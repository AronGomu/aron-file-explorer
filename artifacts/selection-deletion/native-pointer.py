import ctypes as c, os, sys, time
x=c.CDLL('libX11.so.6'); t=c.CDLL('libXtst.so.6')
x.XOpenDisplay.restype=c.c_void_p
x.XDefaultRootWindow.argtypes=[c.c_void_p];x.XDefaultRootWindow.restype=c.c_ulong
x.XQueryTree.argtypes=[c.c_void_p,c.c_ulong,c.POINTER(c.c_ulong),c.POINTER(c.c_ulong),c.POINTER(c.POINTER(c.c_ulong)),c.POINTER(c.c_uint)]
x.XFetchName.argtypes=[c.c_void_p,c.c_ulong,c.POINTER(c.c_char_p)]
x.XInternAtom.argtypes=[c.c_void_p,c.c_char_p,c.c_int]; x.XInternAtom.restype=c.c_ulong
x.XGetWindowProperty.argtypes=[c.c_void_p,c.c_ulong,c.c_ulong,c.c_long,c.c_long,c.c_int,c.c_ulong,c.POINTER(c.c_ulong),c.POINTER(c.c_int),c.POINTER(c.c_ulong),c.POINTER(c.c_ulong),c.POINTER(c.POINTER(c.c_ubyte))]
x.XTranslateCoordinates.argtypes=[c.c_void_p,c.c_ulong,c.c_ulong,c.c_int,c.c_int,c.POINTER(c.c_int),c.POINTER(c.c_int),c.POINTER(c.c_ulong)]
x.XSetInputFocus.argtypes=[c.c_void_p,c.c_ulong,c.c_int,c.c_ulong]
x.XMapRaised.argtypes=[c.c_void_p,c.c_ulong]
x.XFlush.argtypes=[c.c_void_p]
t.XTestFakeMotionEvent.argtypes=[c.c_void_p,c.c_int,c.c_int,c.c_int,c.c_ulong]
t.XTestFakeButtonEvent.argtypes=[c.c_void_p,c.c_uint,c.c_int,c.c_ulong]
d=x.XOpenDisplay(None); root=x.XDefaultRootWindow(d);r=c.c_ulong();p=c.c_ulong();children=c.POINTER(c.c_ulong)();count=c.c_uint();x.XQueryTree(d,root,c.byref(r),c.byref(p),c.byref(children),c.byref(count))
pid=int(open('.tmp/deletion-native/pid').read()); window=None
for i in range(count.value):
    typ=c.c_ulong(); fmt=c.c_int(); items=c.c_ulong(); remaining=c.c_ulong(); data=c.POINTER(c.c_ubyte)()
    x.XGetWindowProperty(d,children[i],x.XInternAtom(d,b'_NET_WM_PID',0),0,1,0,0,c.byref(typ),c.byref(fmt),c.byref(items),c.byref(remaining),c.byref(data))
    if items.value and c.cast(data,c.POINTER(c.c_ulong))[0]==pid:
        name=c.c_char_p();x.XFetchName(d,children[i],c.byref(name))
        if name.value==b'Explr':window=children[i];break
assert window, pid
x.XMapRaised(d,window);x.XSetInputFocus(d,window,1,0);x.XFlush(d);time.sleep(.2)
ox=c.c_int();oy=c.c_int();child=c.c_ulong();x.XTranslateCoordinates(d,window,root,0,0,c.byref(ox),c.byref(oy),c.byref(child))
def move(px,py):
    t.XTestFakeMotionEvent(d,-1,ox.value+int(px),oy.value+int(py),0);x.XFlush(d);time.sleep(.08)
def button(down):t.XTestFakeButtonEvent(d,1,int(down),0);x.XFlush(d);time.sleep(.08)
if __name__=='__main__':
    values=list(map(int,sys.argv[1:5]));move(values[0],values[1]);button(True)
    for index in range(1,11):move(values[0]+(values[2]-values[0])*index/10,values[1]+(values[3]-values[1])*index/10)
    if len(sys.argv)==5:button(False)
    print('Dragged fixture native window',window,'origin',ox.value,oy.value)
