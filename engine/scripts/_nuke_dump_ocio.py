import nuke
root = nuke.root()
root["colorManagement"].setValue("OCIO")
print("colorManagement", root["colorManagement"].value())
print("OCIO_config", root["OCIO_config"].value())
ocs = nuke.createNode("OCIOColorSpace")
ins = [str(x) for x in ocs["in_colorspace"].values()]
outs = [str(x) for x in ocs["out_colorspace"].values()]
for n in ins:
    if "aces" in n.lower() or "srgb" in n.lower() or "output" in n.lower():
        print("IN ", n)
for n in outs:
    if "aces" in n.lower() or "srgb" in n.lower() or "output" in n.lower():
        print("OUT", n)
