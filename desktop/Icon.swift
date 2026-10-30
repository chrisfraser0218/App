import AppKit
let size=1024
let rep=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:size,pixelsHigh:size,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:rep)
NSColor(calibratedRed:0.39,green:0.35,blue:0.86,alpha:1).setFill();NSBezierPath(roundedRect:NSRect(x:30,y:30,width:964,height:964),xRadius:220,yRadius:220).fill()
let text="f" as NSString;text.draw(at:NSPoint(x:300,y:110),withAttributes:[.font:NSFont.boldSystemFont(ofSize:800),.foregroundColor:NSColor.white])
NSColor.white.setFill();let star=NSBezierPath();star.move(to:NSPoint(x:760,y:800));star.line(to:NSPoint(x:785,y:735));star.line(to:NSPoint(x:850,y:710));star.line(to:NSPoint(x:785,y:685));star.line(to:NSPoint(x:760,y:620));star.line(to:NSPoint(x:735,y:685));star.line(to:NSPoint(x:670,y:710));star.line(to:NSPoint(x:735,y:735));star.close();star.fill();NSGraphicsContext.restoreGraphicsState()
let png=rep.representation(using:.png,properties:[:])!;var data=Data("icns".utf8);let total=UInt32(8+8+png.count).bigEndian;withUnsafeBytes(of:total){data.append(contentsOf:$0)};data.append(Data("ic10".utf8));let chunk=UInt32(8+png.count).bigEndian;withUnsafeBytes(of:chunk){data.append(contentsOf:$0)};data.append(png);try data.write(to:URL(fileURLWithPath:CommandLine.arguments[1]))
